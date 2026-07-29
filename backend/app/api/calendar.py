import uuid
from datetime import date, datetime, time, timezone
from fastapi import APIRouter,Depends,HTTPException,Query
from pydantic import AwareDatetime,BaseModel,Field
from sqlalchemy import or_,select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.campaign import Campaign
from app.models.hr import Holiday
from app.models.operations import CompanyEvent
from app.models.recruiting import Candidate,Interview
from app.models.training import Course,CourseAssignment
from app.models.user import User
from app.models.workplace import ApprovalRequest

router=APIRouter(prefix="/calendar",tags=["calendar"])
class EventIn(BaseModel):
 title:str=Field(min_length=1);description:str|None=None;starts_at:AwareDatetime;ends_at:AwareDatetime|None=None;location:str|None=None;company_id:uuid.UUID|None=None
def item(id,kind,title,start,end=None,subtitle=None,href=None):return{"id":str(id),"kind":kind,"title":title,"start":start,"end":end,"subtitle":subtitle,"href":href}
def occurrence(d:date,year:int):
 try:return d.replace(year=year)
 except ValueError:return d.replace(year=year,day=28)
@router.get("")
async def feed(start:date=Query(...),end:date=Query(...),db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
 if end<start or(end-start).days>370:raise HTTPException(422,"Invalid calendar range")
 out=[]
 for h in(await db.execute(select(Holiday).where(Holiday.day>=start,Holiday.day<=end))).scalars():out.append(item(h.id,"holiday",h.name,h.day))
 leaves=(await db.execute(select(ApprovalRequest).where(ApprovalRequest.type=="leave",ApprovalRequest.status=="approved",ApprovalRequest.start_date<=end,or_(ApprovalRequest.end_date.is_(None),ApprovalRequest.end_date>=start)))).scalars().all()
 users={u.id:u for u in(await db.execute(select(User).where(User.status=="active"))).scalars()}
 for l in leaves:
  person=users.get(l.requester_id);title=f"{person.display_name if person else 'Employee'} — leave" if(user.is_admin or user.role=="manager" or l.requester_id==user.id)else"Employee leave"
  out.append(item(l.id,"leave",title,l.start_date,l.end_date or l.start_date,href="/leave"))
 for person in users.values():
  for d,kind,label in((person.date_of_birth,"birthday","Birthday"),(person.hire_date,"anniversary","Work anniversary")):
   if d:
    for year in range(start.year,end.year+1):
     when=occurrence(d,year)
     if start<=when<=end:out.append(item(f"{person.id}-{kind}-{year}",kind,f"{person.display_name or 'Employee'} — {label}",when,href=f"/people/{person.id}"))
 events=(await db.execute(select(CompanyEvent).where(CompanyEvent.starts_at<datetime.combine(end,time.max,tzinfo=timezone.utc),or_(CompanyEvent.ends_at.is_(None),CompanyEvent.ends_at>=datetime.combine(start,time.min,tzinfo=timezone.utc))))).scalars().all()
 for e in events:out.append(item(e.id,"company",e.title,e.starts_at,e.ends_at,e.location,"/calendar"))
 assignments=(await db.execute(select(CourseAssignment,Course).join(Course,Course.id==CourseAssignment.course_id).where(CourseAssignment.due_date>=start,CourseAssignment.due_date<=end,CourseAssignment.user_id==user.id))).all()
 for a,c in assignments:out.append(item(a.id,"training",f"Training due: {c.title}",a.due_date,href="/training"))
 if "campaigns" in user.effective_permissions:
  for c in(await db.execute(select(Campaign).where(or_(Campaign.start_date.between(start,end),Campaign.end_date.between(start,end))))).scalars():
   out.append(item(c.id,"campaign",c.name,c.start_date,c.end_date,href="/campaigns"))
 if "recruiting" in user.effective_permissions:
  begin=datetime.combine(start,time.min,tzinfo=timezone.utc);finish=datetime.combine(end,time.max,tzinfo=timezone.utc)
  for interview,candidate in(await db.execute(select(Interview,Candidate).join(Candidate,Candidate.id==Interview.candidate_id).where(Interview.scheduled_at>=begin,Interview.scheduled_at<=finish))).all():
   out.append(item(interview.id,"interview",f"Interview: {candidate.name}",interview.scheduled_at,subtitle=interview.mode,href="/recruiting"))
 return sorted(out,key=lambda x:str(x["start"]))
@router.post("/events",status_code=201)
async def create(body:EventIn,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
 if not(user.is_admin or user.role=="manager"):raise HTTPException(403,"Manager privileges required")
 if body.ends_at and body.ends_at<body.starts_at:raise HTTPException(422,"End must follow start")
 e=CompanyEvent(**body.model_dump(),created_by_id=user.id);db.add(e);await db.commit();await db.refresh(e);return item(e.id,"company",e.title,e.starts_at,e.ends_at,e.location)
@router.delete("/events/{event_id}",status_code=204)
async def delete(event_id:uuid.UUID,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
 if not(user.is_admin or user.role=="manager"):raise HTTPException(403,"Manager privileges required")
 e=await db.get(CompanyEvent,event_id)
 if e:await db.delete(e);await db.commit()
