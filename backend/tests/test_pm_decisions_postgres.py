"""Migration and concurrent decision writes on disposable local PostgreSQL."""
import asyncio
import os
from pathlib import Path
import subprocess
import sys
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import pm_decisions as api
from app.core.database import Base
from app.models.pm import PmIssue, PmProject, PmProjectMember
from app.models.pm_decision import PmDecision, PmDecisionRevision
from app.models.user import User
from app.schemas.pm_decision import ApprovalInput, DecisionContent, IssueLinkInput, ReasonInput, SubmitInput

pytestmark = pytest.mark.skipif(not os.environ.get("PM_TEST_DATABASE_URL"), reason="Requires disposable local PostgreSQL")


def local_url():
    url = make_url(os.environ["PM_TEST_DATABASE_URL"])
    assert url.drivername == "postgresql+psycopg"
    assert url.host in {"127.0.0.1", "localhost"}
    assert url.database == "pm_regression_test"
    return url


def test_decision_migration_round_trip_preserves_existing_projects():
    url = local_url()
    schema = f"decision_migration_{uuid.uuid4().hex}"
    engine = create_engine(url)
    backend = Path(__file__).resolve().parents[1]
    env = {**os.environ, "DATABASE_URL": url.render_as_string(hide_password=False), "PGOPTIONS": f"-csearch_path={schema}"}

    def migrate(*args):
        result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=backend, env=env, text=True, capture_output=True, timeout=90)
        assert result.returncode == 0, result.stdout + result.stderr

    try:
        with engine.begin() as db:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
        migrate("upgrade", "y1c2d3e4f5a6")
        pid = uuid.uuid4()
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            db.execute(text("INSERT INTO pm_projects (id,key,name) VALUES (:id,'LEGACY','Existing project')"), {"id": pid})
        migrate("upgrade", "head")
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            assert db.scalar(text("SELECT decision_seq FROM pm_projects WHERE id=:id"), {"id": pid}) == 0
            assert db.scalar(text("SELECT version_num FROM alembic_version")) == "a3e4f5a6b7c8"
            assert db.scalar(text("SELECT count(*) FROM pm_decisions")) == 0
        migrate("downgrade", "z2d3e4f5a6b7")
        old, replacement, issue_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            for did, number in ((old, 1), (replacement, 2)):
                db.execute(text("""INSERT INTO pm_decisions
                    (id,project_id,number,title,category,context,approach,rationale,alternatives,status,evidence,version,revision_number,approved_revision_number)
                    VALUES (:id,:pid,:number,'Policy','business','Context','Approach','Reason','','approved','[]',3,2,2)"""),
                    {"id": did, "pid": pid, "number": number})
            db.execute(text("UPDATE pm_decisions SET status='superseded', superseded_by_id=:replacement WHERE id=:id"), {"replacement": replacement, "id": old})
            db.execute(text("""INSERT INTO pm_decision_events (id,decision_id,revision_number,actor_name,action,note,details)
                VALUES (:id,:replacement,1,'Author','replaces_decision','Original replacement',CAST(:details AS JSON))"""),
                {"id": uuid.uuid4(), "replacement": replacement, "details": '{"previous_id":"' + str(old) + '"}'})
            db.execute(text("INSERT INTO pm_issues (id,project_id,number,summary) VALUES (:id,:pid,1,'Existing issue')"), {"id": issue_id, "pid": pid})
            db.execute(text("INSERT INTO pm_decision_issue_links (id,decision_id,issue_id) VALUES (:id,:did,:iid)"), {"id": uuid.uuid4(), "did": old, "iid": issue_id})
        migrate("upgrade", "head")
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            link = db.execute(text("SELECT relationship,added_by_id,added_by_name,added_at FROM pm_decision_issue_links")).one()
            assert tuple(link) == ("relates_to", None, None, None)
            # Latest approval is 2; historical replacement must still point to 1.
            assert db.scalar(text("SELECT superseded_by_revision_number FROM pm_decisions WHERE id=:id"), {"id": old}) == 1
        migrate("downgrade", "z2d3e4f5a6b7")
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            assert db.scalar(text("SELECT count(*) FROM pm_decision_issue_links")) == 1
        migrate("upgrade", "head")
        migrate("downgrade", "y1c2d3e4f5a6")
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            assert db.scalar(text("SELECT name FROM pm_projects WHERE id=:id"), {"id": pid}) == "Existing project"
            # Qualify the name so another schema's decision table cannot mask a failed drop.
            assert db.scalar(text("SELECT to_regclass(:name)"), {"name": f"{schema}.pm_decisions"}) is None
        migrate("upgrade", "head")
    finally:
        with engine.begin() as db:
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()


def test_concurrent_numbering_submission_and_approval_vs_withdrawal():
    async def scenario():
        engine = create_async_engine(local_url())
        schema = f"decision_race_{uuid.uuid4().hex}"
        scoped = engine.execution_options(schema_translate_map={None: schema})
        sessions = async_sessionmaker(scoped, expire_on_commit=False)
        try:
            async with engine.begin() as db:
                await db.execute(text(f'CREATE SCHEMA "{schema}"'))
            async with scoped.begin() as db:
                await db.run_sync(Base.metadata.create_all)
            async with sessions() as db:
                proposer = User(email="author@example.test", display_name="Author", is_admin=True, status="active")
                approver = User(email="reviewer@example.test", display_name="Reviewer", status="active")
                db.add_all([proposer, approver])
                await db.flush()
                project = PmProject(key="RACE", name="Decisions")
                db.add(project)
                await db.flush()
                db.add_all([PmProjectMember(project_id=project.id, user_id=proposer.id, role="admin"),
                            PmProjectMember(project_id=project.id, user_id=approver.id, role="viewer")])
                await db.commit()
                pid = project.id
                content = DecisionContent(title="Concurrent decision", context="Test", approach="Serialize writes", rationale="Preserve evidence",
                                          owner_id=proposer.id, approver_id=approver.id)

            async def create():
                async with sessions() as db:
                    return await api.create_decision(pid, content, db, proposer)

            created = await asyncio.gather(*(create() for _ in range(8)))
            assert {row["key"] for row in created} == {f"RACE-DEC-{n}" for n in range(1, 9)}
            row = created[0]

            async def submit():
                async with sessions() as db:
                    try:
                        return await api.submit_decision(row["id"], SubmitInput(version=1, change_summary="Initial"), db, proposer)
                    except HTTPException as exc:
                        await db.rollback()
                        return exc.status_code

            submissions = await asyncio.gather(submit(), submit())
            assert len([x for x in submissions if x == 409]) == 1
            pending = next(x for x in submissions if isinstance(x, dict))

            async def decide(approve):
                async with sessions() as db:
                    try:
                        if approve:
                            return await api.approve_decision(row["id"], ApprovalInput(version=pending["version"], revision_number=1, outcome="approved"), db, approver)
                        return await api.revise_decision(row["id"], ReasonInput(version=pending["version"], reason="Withdraw"), db, proposer)
                    except HTTPException as exc:
                        await db.rollback()
                        return exc.status_code

            outcomes = await asyncio.gather(decide(True), decide(False))
            assert len([x for x in outcomes if x == 409]) == 1
            async with sessions() as db:
                saved = await db.get(PmDecision, row["id"])
                assert saved.version == 3 and saved.status in {"draft", "approved"}
                revisions = (await db.scalars(select(PmDecisionRevision).where(PmDecisionRevision.decision_id == saved.id))).all()
                assert len(revisions) == 1 and revisions[0].snapshot["approach"] == "Serialize writes"
                assert saved.approved_revision_number == (1 if saved.status == "approved" else None)

            # Link and lifecycle writes share the same locks/version boundary.
            async with sessions() as db:
                issue = PmIssue(project_id=pid, number=1, summary="Implementation task", issue_type="task")
                db.add(issue)
                await db.commit()
                iid = issue.id
            async def track(relationship):
                async with sessions() as db:
                    try:
                        return await api.link_issue(row["id"], IssueLinkInput(version=3, issue_id=iid, relationship=relationship), db, proposer)
                    except HTTPException as exc:
                        await db.rollback()
                        return exc.status_code
            tracked = await asyncio.gather(track("implements"), track("affects"))
            assert len([x for x in tracked if x == 409]) == 1
            winner = next(x for x in tracked if isinstance(x, dict))
            assert winner["version"] == 4 and len(winner["issues"]) == 1 and len(winner["revisions"]) == 1
            assert winner["status"] == saved.status and winner["approved_revision_number"] == saved.approved_revision_number
        finally:
            async with engine.begin() as db:
                await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await engine.dispose()

    if sys.platform == "win32":
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(scenario())
    else:
        asyncio.run(scenario())
