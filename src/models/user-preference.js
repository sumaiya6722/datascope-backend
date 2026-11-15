import mongoose from "mongoose";

const userPreferenceSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    preferences: {
      theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
      pageSize: { type: Number, enum: [25, 50, 100], default: 25 },
      dateFormat: { type: String, trim: true, default: "YYYY-MM-DD" },
      timeZone: { type: String, trim: true, default: "UTC" },
    },
  },
  { collection: "userPreferences", timestamps: true },
);

userPreferenceSchema.index({ userId: 1 }, { unique: true });

export const UserPreference =
  mongoose.models.UserPreference ?? mongoose.model("UserPreference", userPreferenceSchema);
