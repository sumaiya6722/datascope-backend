import mongoose from "mongoose";

export async function connectDatabase(connectionString) {
  if (!connectionString) {
    throw new Error("MONGODB_URI is required to start the backend.");
  }

  await mongoose.connect(connectionString, { dbName: "datascope" });
  console.log("Connected to MongoDB.");

  if (!mongoose.connection.db) {
    throw new Error("MongoDB connected without exposing a database handle.");
  }

  return mongoose.connection.db;
}
