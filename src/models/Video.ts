import mongoose from "mongoose";

const VideoSchema = new mongoose.Schema({
  title: String,
  filePath: { type: String, required: true, unique: true },
  shorts: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
});

export const Video = mongoose.models.Video || mongoose.model("Video", VideoSchema);
