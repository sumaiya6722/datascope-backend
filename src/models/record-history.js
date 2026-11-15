import mongoose from "mongoose";

const recordHistorySchema = new mongoose.Schema(
  {
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dataset",
      required: true,
    },
    recordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DatasetRecord",
      required: true,
    },
    action: {
      type: String,
      enum: ["created", "updated", "deleted"],
      required: true,
    },
    changedBy: { type: String, required: true },
    changes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    snapshot: { type: mongoose.Schema.Types.Mixed },
  },
  { collection: "recordHistory", timestamps: { createdAt: true, updatedAt: false } },
);

recordHistorySchema.index({ datasetId: 1, recordId: 1, createdAt: -1 });
recordHistorySchema.index({ changedBy: 1, createdAt: -1 });

export const RecordHistory =
  mongoose.models.RecordHistory ?? mongoose.model("RecordHistory", recordHistorySchema);
