// Temp script to check demo dataset permissions for viewers
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Dataset from './src/models/dataset.js';
import DatasetAccessPermission from './src/models/dataset-access-permission.js';
import User from './src/models/user.js';

dotenv.config({ path: '.env' });

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const demos = await Dataset.find({ slug: { $in: ['customer-directory', 'product-inventory', 'sales-transactions'] } }).lean();
    console.log('Demo datasets:', demos.map(d => ({ slug: d.slug, id: d._id.toString() })));
    const viewers = await User.find({ role: 'viewer' }).lean();
    console.log('Viewer count:', viewers.length);
    for (const v of viewers) {
      const perms = await DatasetAccessPermission.find({ userId: v._id.toString(), permissions: { $all: ['read'] } }).lean();
      console.log('Viewer', v.email, 'grants', perms.map(p => p.datasetId.toString()));
    }
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await mongoose.disconnect();
  }
})();
