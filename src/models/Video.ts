import mongoose from "mongoose";

const VideoSchema = new mongoose.Schema({
  title: String,
  filePath: String,
  shorts: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
});

export const Video = mongoose.models.Video || mongoose.model("Video", VideoSchema);
