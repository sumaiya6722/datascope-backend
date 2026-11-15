import mongoose from "mongoose";

const datasetAccessPermissionSchema = new mongoose.Schema(
  {
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dataset",
      required: true,
    },
    userId: { type: String, required: true },
    permissions: {
      type: [{ type: String, enum: ["read", "export"] }],
      required: true,
      validate: {
        validator: (permissions) => Array.isArray(permissions) && permissions.length > 0,
        message: "At least one dataset permission is required.",
      },
    },
    grantedBy: { type: String, default: null },
  },
  { collection: "datasetPermissions", timestamps: true },
);

datasetAccessPermissionSchema.index({ datasetId: 1, userId: 1 }, { unique: true });
datasetAccessPermissionSchema.index({ userId: 1, permissions: 1 });

export const DatasetAccessPermission =
  mongoose.models.DatasetAccessPermission ??
  mongoose.model("DatasetAccessPermission", datasetAccessPermissionSchema);
