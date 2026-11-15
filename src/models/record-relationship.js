import mongoose from "mongoose";

const recordRelationshipSchema = new mongoose.Schema(
  {
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dataset",
      required: true,
    },
    sourceRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DatasetRecord",
      required: true,
    },
    targetRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DatasetRecord",
      required: true,
    },
    type: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    createdBy: { type: String, required: true },
  },
  { collection: "recordRelationships", timestamps: true },
);

recordRelationshipSchema.index(
  { datasetId: 1, sourceRecordId: 1, targetRecordId: 1, type: 1 },
  { unique: true },
);
recordRelationshipSchema.index({ datasetId: 1, targetRecordId: 1 });

export const RecordRelationship =
  mongoose.models.RecordRelationship ??
  mongoose.model("RecordRelationship", recordRelationshipSchema);
