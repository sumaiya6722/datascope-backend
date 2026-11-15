import mongoose from "mongoose";

const datasetFieldSchema = new mongoose.Schema(
  {
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dataset",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    dataType: {
      type: String,
      enum: ["string", "number", "date", "boolean", "email", "phone", "currency", "object"],
      required: true,
    },
    searchable: { type: Boolean, default: false },
    filterable: { type: Boolean, default: false },
    sortable: { type: Boolean, default: false },
    visibleByDefault: { type: Boolean, default: true },
  },
  { collection: "datasetFields", timestamps: true },
);

datasetFieldSchema.index({ datasetId: 1, name: 1 }, { unique: true });
datasetFieldSchema.index({ datasetId: 1, searchable: 1, filterable: 1 });

export const DatasetField =
  mongoose.models.DatasetField ?? mongoose.model("DatasetField", datasetFieldSchema);
