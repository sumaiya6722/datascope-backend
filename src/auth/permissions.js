// Permission helper for demo datasets
import { Dataset } from "../models/dataset.js";
import { DatasetAccessPermission } from "../models/dataset-access-permission.js";

// Slugs of the three demo datasets that every Viewer should be able to read
const DEMO_SLUGS = [
  "customer-directory",
  "product-inventory",
  "sales-transactions",
];

/**
 * Grants read‑only access to the three demo datasets for the given viewer.
 * Idempotent – calling it multiple times will not duplicate permissions.
 * @param {string} viewerId - The user._id string as stored in DatasetAccessPermission.userId
 */
export async function grantDemoDatasetAccessToViewer(viewerId) {
  // Load the demo datasets (if any are missing we simply skip them)
  const demoDatasets = await Dataset.find({ slug: { $in: DEMO_SLUGS } }).lean();

  for (const ds of demoDatasets) {
    // Use $addToSet so the "read" permission is added only once.
    await DatasetAccessPermission.updateOne(
      { datasetId: ds._id, userId: viewerId },
      {
        $addToSet: { permissions: "read" },
        $setOnInsert: { grantedBy: null },
      },
      { upsert: true }
    );
  }
}
