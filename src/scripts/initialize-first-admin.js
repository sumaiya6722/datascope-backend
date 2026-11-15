import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { initializeFirstAdministrator } from "../authorization/initialize-first-admin.js";

const emailIndex = process.argv.indexOf("--email");
const email = emailIndex >= 0 ? process.argv[emailIndex + 1] : undefined;

try {
  const database = await connectDatabase(process.env.MONGODB_URI);
  const administrator = await initializeFirstAdministrator(database, email);
  console.log(`Initialized the first DataScope Administrator: ${administrator.email}`);
} catch (error) {
  console.error(`Could not initialize the first Administrator: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
