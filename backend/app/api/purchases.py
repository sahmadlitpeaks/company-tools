import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.operations import PurchaseRequest
from app.models.subscription import Subscription
from app.models.tracked_asset import TrackedAsset
from app.models.user import User
from app.models.workplace import ApprovalRequest
from app.services import approval_engine as engine
from app.services.notify import notify_user
from app.services.people import user_names

router=APIRouter(prefix="/purchases",tags=["purchases"])
class PurchaseIn(BaseModel):
 item:str=Field(min_length=1);reason:str=Field(min_length=1);vendor:str|None=None;department:str|None=None
 estimated_cost:Decimal|None=Field(default=None,ge=0);target_type:str;company_id:uuid.UUID|None=None
class ConvertIn(BaseModel): final_cost:Decimal|None=Field(default=None,ge=0)
async def out(db,p):
 a=await db.get(ApprovalRequest,p.approval_id);names=await user_names(db,{p.requester_id})
 return {"id":p.id,"item":p.item,"reason":p.reason,"vendor":p.vendor,"department":p.department,"estimated_cost":p.estimated_cost,"final_cost":p.final_cost,"target_type":p.target_type,"requester_id":p.requester_id,"requester_name":names.get(p.requester_id),"approval_id":p.approval_id,"approval_status":a.status if a else None,"purchased_at":p.purchased_at,"result_type":p.result_type,"result_id":p.result_id,"created_at":p.created_at}
@router.post("",status_code=201)
async def create(body:PurchaseIn,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
 if body.target_type not in {"asset","subscription"}:raise HTTPException(422,"Target type must be asset or subscription")
 a=ApprovalRequest(type="purchase",title=f"Purchase: {body.item}",details=body.reason,amount=body.estimated_cost,requester_id=user.id,company_id=body.company_id)
 db.add(a);await db.flush();await engine.instantiate(db,a,user)
 p=PurchaseRequest(**body.model_dump(),requester_id=user.id,approval_id=a.id);db.add(p)
 if a.approver_id and a.status=="pending":await notify_user(db,user_id=a.approver_id,title="Purchase request needs review",body=body.item,link="/approvals",category="approval")
 await db.commit();await db.refresh(p);return await out(db,p)
@router.get("")
async def listing(db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
 stmt=select(PurchaseRequest).order_by(PurchaseRequest.created_at.desc())
 if not(user.is_admin or user.role=="manager"):stmt=stmt.where(PurchaseRequest.requester_id==user.id)
 return[await out(db,p) for p in(await db.execute(stmt)).scalars().all()]
@router.post("/{pid}/convert")
async def convert(pid:uuid.UUID,body:ConvertIn,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
 if not(user.is_admin or user.role=="manager"):raise HTTPException(403,"Manager privileges required")
 p=(await db.execute(select(PurchaseRequest).where(PurchaseRequest.id==pid).with_for_update())).scalar_one_or_none()
 if not p:raise HTTPException(404,"Purchase request not found")
 if p.result_id:raise HTTPException(409,"Purchase request was already converted")
 a=await db.get(ApprovalRequest,p.approval_id)
 if not a or a.status!="approved":raise HTTPException(409,"Purchase request must be approved first")
 p.final_cost=body.final_cost if body.final_cost is not None else p.estimated_cost;p.purchased_at=datetime.now(timezone.utc)
 if p.target_type=="asset":
  target=TrackedAsset(asset_tag=f"PR-{str(p.id)[:8].upper()}",name=p.item,status="available",vendor=p.vendor,purchase_date=date.today(),purchase_cost=p.final_cost,company_id=p.company_id)
 else:
  target=Subscription(name=p.item,vendor=p.vendor,status="active",scope="company",cost_type="flat",cost=p.final_cost,currency="AED",billing_cycle="monthly",start_date=date.today(),company_id=p.company_id)
 db.add(target);await db.flush();p.result_type=p.target_type;p.result_id=target.id
 await db.commit();return await out(db,p)
