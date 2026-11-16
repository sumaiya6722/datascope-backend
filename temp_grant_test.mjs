import 'dotenv/config';
import mongoose from 'mongoose';
import { grantDemoDatasetAccessToViewer } from './src/auth/permissions.js';
import { User } from './src/models/index.js';

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    // pick a viewer (existing) or create a test viewer
    let viewer = await User.findOne({ role: 'viewer' }).lean();
    if (!viewer) {
      console.log('No viewer found, creating test viewer');
      const res = await User.create({ email: 'tempviewer@example.com', password: 'Password123!', role: 'viewer' });
      viewer = res;
    }
    console.log('Viewer ID:', viewer._id.toString());
    await grantDemoDatasetAccessToViewer(viewer._id.toString());
    console.log('Grant function executed');
  } catch (e) {
    console.error('Error', e);
  } finally {
    await mongoose.disconnect();
  }
})();