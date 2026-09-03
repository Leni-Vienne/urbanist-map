import { trpc } from "@/client";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { refreshEditSessionData } from "@/services/map/viewportTriggers";
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
  const changeRequest = store.pendingChangeRequests.find((cr) => cr.id === changeRequestId);

  try {
    await trpc.changes.deleteChangeRequest.mutate({ id: changeRequestId });

    if (changeRequest) {
      store.removeChangeRequest(changeRequestId);
    }

    const sessionRefresh =
      changeRequest?.entityType === "overlay" ? refreshEditSessionData() : Promise.resolve();
    await Promise.all([refreshUserContributions(), sessionRefresh]);

    return true;
  } catch (error) {
    console.error("Failed to delete change request:", error);
    return false;
  }
}
