import mongoose from "mongoose";

const dataSourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const datasetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, trim: true, default: "" },
    category: { type: String, required: true, trim: true },
    dataSource: { type: dataSourceSchema, required: true },
    totalRecords: { type: Number, min: 0, default: 0 },
    creatorId: { type: String, required: true, trim: true },
  },
  {
    collection: "datasets",
    timestamps: true,
    strict: true,
  },
);

datasetSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: "string" } } },
);
datasetSchema.index({ category: 1, updatedAt: -1 });
datasetSchema.index({ creatorId: 1, createdAt: -1 });
datasetSchema.virtual("accessPermissions", {
  ref: "DatasetAccessPermission",
  localField: "_id",
  foreignField: "datasetId",
});

export const Dataset =
  mongoose.models.Dataset ?? mongoose.model("Dataset", datasetSchema);
