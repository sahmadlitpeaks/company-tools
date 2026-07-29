import uuid
from fastapi import APIRouter,Depends,HTTPException
from pydantic import AwareDatetime,BaseModel,Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.operations import LostFoundReport
from app.models.user import User
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names
router=APIRouter(prefix="/lost-found",tags=["lost-found"])
class ReportIn(BaseModel):kind:str;description:str=Field(min_length=1);location:str=Field(min_length=1);item_date:AwareDatetime;company_id:uuid.UUID|None=None
class StatusIn(BaseModel):status:str
async def out(db,r):
 names=await user_names(db,{r.reporter_id,r.claimant_id})
 return{"id":r.id,"kind":r.kind,"description":r.description,"location":r.location,"item_date":r.item_date,"status":r.status,"reporter_id":r.reporter_id,"reporter_name":names.get(r.reporter_id),"claimant_id":r.claimant_id,"claimant_name":names.get(r.claimant_id),"created_at":r.created_at}
@router.get("")
async def listing(db:AsyncSession=Depends(get_db),_:User=Depends(get_current_user)):
 return[await out(db,r) for r in(await db.execute(select(LostFoundReport).order_by(LostFoundReport.created_at.desc()))).scalars().all()]
@router.post("",status_code=201)
async def create(body:ReportIn,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
 if body.kind not in{"lost","found"}:raise HTTPException(422,"Kind must be lost or found")
 r=LostFoundReport(**body.model_dump(),reporter_id=user.id,status="open");db.add(r);await db.flush();record(db,user=user,action="created",entity_type="lost_found",entity_id=r.id,summary=f"Reported {r.kind} item at {r.location}");await db.commit();await db.refresh(r);return await out(db,r)
@router.post("/{report_id}/claim")
async def claim(report_id:uuid.UUID,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
 r=(await db.execute(select(LostFoundReport).where(LostFoundReport.id==report_id).with_for_update())).scalar_one_or_none()
 if not r:raise HTTPException(404,"Report not found")
 if r.status!="open":raise HTTPException(409,"Item is no longer open")
 r.claimant_id=user.id;r.status="claimed"
 if r.reporter_id!=user.id:await notify_user(db,user_id=r.reporter_id,title="Someone claimed your lost & found report",body=r.description[:200],link="/lost-found",category="lost_found")
 await db.commit();await db.refresh(r);return await out(db,r)
@router.post("/{report_id}/status")
async def status(report_id:uuid.UUID,body:StatusIn,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
 if body.status not in{"open","claimed","returned","closed"}:raise HTTPException(422,"Invalid status")
 r=await db.get(LostFoundReport,report_id)
 if not r:raise HTTPException(404,"Report not found")
 if not(user.is_admin or user.role=="manager" or r.reporter_id==user.id):raise HTTPException(403,"Only the reporter or a manager can resolve this report")
 if body.status in{"returned","closed"} and r.status not in{"claimed","returned"}:raise HTTPException(409,"The item must be claimed first")
 r.status=body.status
 if r.claimant_id and body.status=="returned":await notify_user(db,user_id=r.claimant_id,title="Lost & found item marked returned",body=r.description[:200],link="/lost-found",category="lost_found")
 record(db,user=user,action="status",entity_type="lost_found",entity_id=r.id,summary=f"Lost & found report moved to {body.status}");await db.commit();await db.refresh(r);return await out(db,r)
