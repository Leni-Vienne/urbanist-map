// AI : Shared form data types

// AI : Form data type for project fields
export interface ProjectFormData {
  name: string;
  description: string | null;
  proposalDate: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  latestUpdateOn?: Date | null;
  cityId: string | null;
  sourceUrl: string | null;
}

// AI : Shared field change type for both project and overlay forms
export interface FieldChange {
  fieldName: string;
  oldValue: any;
  newValue: any;
  changeReason?: string;
}
