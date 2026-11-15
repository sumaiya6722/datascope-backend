import mongoose from "mongoose";

const searchHistorySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dataset",
      default: null,
    },
    query: { type: String, trim: true, default: "" },
    searchMode: { type: String, enum: ["partial", "exact", "text"], default: "partial" },
    filters: { type: [mongoose.Schema.Types.Mixed], default: [] },
    sort: { type: [String], default: [] },
    description: { type: String, trim: true, maxlength: 240, default: "" },
    resultCount: { type: Number, min: 0, default: 0 },
    searchedAt: { type: Date, default: Date.now },
  },
  { collection: "searchHistory", timestamps: false },
);

searchHistorySchema.index({ userId: 1, searchedAt: -1 });
searchHistorySchema.index({ userId: 1, datasetId: 1, searchedAt: -1 });
searchHistorySchema.index({ datasetId: 1, searchedAt: -1 });

export const SearchHistory =
  mongoose.models.SearchHistory ?? mongoose.model("SearchHistory", searchHistorySchema);
