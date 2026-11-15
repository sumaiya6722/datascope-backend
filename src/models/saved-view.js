import mongoose from "mongoose";

const savedViewSchema = new mongoose.Schema(
  {
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dataset",
      required: true,
    },
    ownerId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, default: "" },
    query: { type: String, trim: true, maxlength: 100, default: "" },
    searchMode: { type: String, enum: ["partial", "exact", "text"], default: "partial" },
    filters: { type: [mongoose.Schema.Types.Mixed], default: [] },
    sort: { type: [String], default: [] },
    visibleFields: { type: [String], default: [] },
    sharedWith: { type: [String], default: [] },
  },
  { collection: "savedViews", timestamps: true },
);

savedViewSchema.index({ ownerId: 1, datasetId: 1, updatedAt: -1 });
savedViewSchema.index({ sharedWith: 1, datasetId: 1, updatedAt: -1 });
savedViewSchema.index({ datasetId: 1, updatedAt: -1 });

export const SavedView =
  mongoose.models.SavedView ?? mongoose.model("SavedView", savedViewSchema);
