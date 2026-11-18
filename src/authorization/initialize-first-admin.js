import { ROLES } from "./permissions.js";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function initializeFirstAdministrator(database, email) {
  const normalizedEmail = email?.trim();
  if (!normalizedEmail) {
    throw new Error("Provide the email address of an already registered user.");
  }

  const user = await database.collection("user").findOne({
    email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: "i" },
  });
  if (!user) {
    throw new Error("No registered user matches that email. Register the account before initializing it.");
  }

  const bootstrap = database.collection("authorizationBootstrap");
  const bootstrapId = "first-administrator";
  const userId = user._id.toString();
  const existingClaim = await bootstrap.findOne({ _id: bootstrapId });

  if (existingClaim && existingClaim.userId !== userId) {
    throw new Error("The first-administrator slot has already been claimed by another account.");
  }

  if (!existingClaim) {
    if (await database.collection("user").countDocuments({ role: ROLES.ADMINISTRATOR })) {
      throw new Error("An Administrator already exists. The first-admin initializer can only run once.");
    }

    try {
      await bootstrap.insertOne({
        _id: bootstrapId,
        userId,
        createdAt: new Date(),
      });
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }

      const competingClaim = await bootstrap.findOne({ _id: bootstrapId });
      if (competingClaim?.userId !== userId) {
        throw new Error("The first-administrator slot has already been claimed by another account.");
      }
    }
  }

  if (user.role === ROLES.ADMINISTRATOR) {
    return { id: userId, email: user.email };
  }

  const result = await database.collection("user").updateOne(
    { _id: user._id, role: { $ne: ROLES.ADMINISTRATOR } },
    { $set: { role: ROLES.ADMINISTRATOR, updatedAt: new Date() } },
  );

  if (!result.matchedCount) {
    const updatedUser = await database.collection("user").findOne(
      { _id: user._id },
      { projection: { role: 1 } },
    );
    if (updatedUser?.role !== ROLES.ADMINISTRATOR) {
      throw new Error("The selected user could not be promoted.");
    }
  }

  return { id: userId, email: user.email };
}
