import mongoose from "mongoose";

const datasetRecordSchema = new mongoose.Schema(
  {
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dataset",
      required: true,
    },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    seedKey: { type: String, trim: true, select: false },
  },
  {
    collection: "records",
    timestamps: true,
    strict: true,
    minimize: false,
  },
);

datasetRecordSchema.index({ datasetId: 1, createdAt: -1 });
datasetRecordSchema.index({ datasetId: 1, updatedAt: -1 });
datasetRecordSchema.index({ datasetId: 1, "data.industry": 1 });
datasetRecordSchema.index({ datasetId: 1, "data.country": 1 });
datasetRecordSchema.index({ datasetId: 1, "data.status": 1 });
datasetRecordSchema.index({ datasetId: 1, "data.revenue": 1 });
datasetRecordSchema.index(
  { datasetId: 1, seedKey: 1 },
  {
    unique: true,
    partialFilterExpression: { seedKey: { $type: "string" } },
  },
);
datasetRecordSchema.index({
  "data.companyName": "text",
  "data.industry": "text",
  "data.country": "text",
  "data.category": "text",
  "data.contact.email": "text",
});

export const DatasetRecord =
  mongoose.models.DatasetRecord ?? mongoose.model("DatasetRecord", datasetRecordSchema);
