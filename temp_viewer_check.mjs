import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from './src/models/index.js';
import { DatasetAccessPermission } from './src/models/dataset-access-permission.js';
import { Dataset } from './src/models/dataset.js';

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const viewer = await User.findOne({ role: 'viewer' }).lean();
    console.log('Viewer:', viewer?.email, viewer?._id?.toString());
    if (viewer) {
      const perms = await DatasetAccessPermission.find({ userId: viewer._id.toString() }).lean();
      console.log('Permission docs count:', perms.length);
      for (const p of perms) {
        const ds = await Dataset.findById(p.datasetId).lean();
        console.log('Grant ->', { datasetId: p.datasetId.toString(), slug: ds?.slug, permissions: p.permissions });
      }
    }
  } catch (e) {
    console.error('Error', e);
  } finally {
    await mongoose.disconnect();
  }
})();