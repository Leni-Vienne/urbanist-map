import { useChangeRequests } from './useChangeRequests';

export function useFieldChanges() {
  const { submitChangeRequest } = useChangeRequests();

  async function submitProjectFieldChange(
    projectId: string,
    fieldName: string,
    oldValue: any,
    newValue: any,
    changeReason?: string
  ) {
    try {
      return submitChangeRequest({
        entityType: 'project',
        entityId: projectId,
        changes: [{
          fieldName,
          oldValue,
          newValue,
          changeReason,
        }]
      });
    } catch (error) {
      console.error('Failed to submit project field change:', error);
      throw error;
    }
  }

  async function submitOverlayFieldChange(
    overlayId: string,
    fieldName: string,
    oldValue: any,
    newValue: any,
    changeReason?: string
  ) {
    try {
      return submitChangeRequest({
        entityType: 'overlay',
        entityId: overlayId,
        changes: [{
          fieldName,
          oldValue,
          newValue,
          changeReason,
        }]
      });
    } catch (error) {
      console.error('Failed to submit overlay field change:', error);
      throw error;
    }
  }

  async function submitMultipleFieldChanges(
    entityType: 'project' | 'overlay',
    entityId: string,
    fieldChanges: Array<{
      fieldName: string;
      oldValue: any;
      newValue: any;
      changeReason?: string;
    }>
  ) {
    try {
      return submitChangeRequest({
        entityType,
        entityId,
        changes: fieldChanges
      });
    } catch (error) {
      console.error('Failed to submit multiple field changes:', error);
      throw error;
    }
  }

  function createFieldChangeHelper(entityType: 'project' | 'overlay', entityId: string) {
    const pendingChanges: Array<{
      fieldName: string;
      oldValue: any;
      newValue: any;
      changeReason?: string;
    }> = [];

    function addFieldChange(fieldName: string, oldValue: any, newValue: any, changeReason?: string) {
      const existingIndex = pendingChanges.findIndex(change => change.fieldName === fieldName);
      
      if (existingIndex >= 0) {
        pendingChanges[existingIndex] = { fieldName, oldValue, newValue, changeReason };
      } else {
        pendingChanges.push({ fieldName, oldValue, newValue, changeReason });
      }
    }

    function removeFieldChange(fieldName: string) {
      const index = pendingChanges.findIndex(change => change.fieldName === fieldName);
      if (index >= 0) {
        pendingChanges.splice(index, 1);
      }
    }

    async function submitAllChanges() {
      if (pendingChanges.length === 0) {
        throw new Error('No changes to submit');
      }

      const result = await submitMultipleFieldChanges(entityType, entityId, [...pendingChanges]);
      
      if (result.success) {
        pendingChanges.length = 0;
      }
      
      return result;
    }

    function clearChanges() {
      pendingChanges.length = 0;
    }

    function getChanges() {
      return [...pendingChanges];
    }

    function hasChanges() {
      return pendingChanges.length > 0;
    }

    return {
      addFieldChange,
      removeFieldChange,
      submitAllChanges,
      clearChanges,
      getChanges,
      hasChanges,
    };
  }

  return {
    submitProjectFieldChange,
    submitOverlayFieldChange,
    submitMultipleFieldChanges,
    createFieldChangeHelper,
  };
}