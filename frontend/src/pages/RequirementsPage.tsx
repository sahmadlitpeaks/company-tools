import { RequirementRegister } from "@/components/pm/RequirementRegister";
import { PageHead } from "@/components/ui";

export default function RequirementsPage() {
  return <div className="flex flex-col gap-5"><PageHead headingLevel={1} title="Requirements" subtitle="The source of truth for what the team needs to build." /><RequirementRegister /></div>;
}
