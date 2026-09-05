import { trpc } from "@/client";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { refreshUserContributions } from "@/services/project/userContributions";

export async function approveChangeRequests(changeRequestIds: string[]) {
  try {
    await trpc.changes.approveChangeRequests.mutate({ changeRequestIds });

    useChangeRequestStore().resetLoaded();

    return true;
  } catch (error) {
    console.error("Failed to approve change requests:", error);
    return null;
  }
}

export async function rejectChangeRequests(changeRequestIds: string[]): Promise<boolean> {
  try {
    await trpc.changes.rejectChangeRequests.mutate({ changeRequestIds });

    useChangeRequestStore().removeChangeRequests(changeRequestIds);

    return true;
  } catch (error) {
    console.error("Failed to reject change requests:", error);
    return false;
  }
}

export async function deleteChangeRequest(changeRequestId: string): Promise<boolean> {
  const store = useChangeRequestStore();

  try {
    await trpc.changes.deleteChangeRequest.mutate({ id: changeRequestId });

    store.removeChangeRequest(changeRequestId);

    await refreshUserContributions();

    return true;
  } catch (error) {
    console.error("Failed to delete change request:", error);
    return false;
  }
}
