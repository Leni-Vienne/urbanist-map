import { router } from "../../trpc";
import { queueProcedures } from "./queue";
import { approvalProcedures } from "./approvals";
import { reportProcedures } from "./reports";
import { detachedProcedures } from "./detached";

export const moderationRouter = router({
  ...queueProcedures,
  ...approvalProcedures,
  ...reportProcedures,
  ...detachedProcedures,
});
