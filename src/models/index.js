import { Dataset } from "./dataset.js";
import { DatasetAccessPermission } from "./dataset-access-permission.js";
import { DatasetField } from "./dataset-field.js";
import { DatasetRecord } from "./dataset-record.js";
import { RecordHistory } from "./record-history.js";
import { RecordRelationship } from "./record-relationship.js";
import { SavedView } from "./saved-view.js";
import { SearchHistory } from "./search-history.js";
import { UserPreference } from "./user-preference.js";

export {
  Dataset,
  DatasetAccessPermission,
  DatasetField,
  DatasetRecord,
  RecordHistory,
  RecordRelationship,
  SavedView,
  SearchHistory,
  UserPreference,
};

export async function initializeDataModels() {
  await Promise.all(
    [
      Dataset,
      DatasetAccessPermission,
      DatasetField,
      DatasetRecord,
      RecordHistory,
      RecordRelationship,
      SavedView,
      SearchHistory,
      UserPreference,
    ].map((model) => model.init()),
  );
}
