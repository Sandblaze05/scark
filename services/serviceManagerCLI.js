import ServiceManager from '../lib/ServiceManager.js';
import './chromaLauncher.js';

async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || 'start';
  const serviceName = args[1] || 'chroma';

  if (action === 'start') {
    try {
      await ServiceManager.startService(serviceName);
      console.log(`[serviceManagerCLI] ${serviceName} start requested.`);
    } catch (err) {
      console.error('[serviceManagerCLI] start failed:', err);
      process.exit(1);
    }
  } else if (action === 'stop') {
    try {
      await ServiceManager.stopService(serviceName);
      console.log(`[serviceManagerCLI] ${serviceName} stop requested.`);
    } catch (err) {
      console.error('[serviceManagerCLI] stop failed:', err);
      process.exit(1);
    }
  } else if (action === 'status') {
    try {
      if (serviceName === 'all') {
        console.log(JSON.stringify(ServiceManager.listServiceStatuses(), null, 2));
      } else {
        console.log(JSON.stringify(ServiceManager.getServiceStatus(serviceName), null, 2));
      }
    } catch (err) {
      console.error('[serviceManagerCLI] status failed:', err);
      process.exit(1);
    }
  } else {
    console.log('Usage: node services/serviceManagerCLI.js [start|stop|status] [service|all]');
    process.exit(0);
  }
}

if (process.argv[1] && (process.argv[1].endsWith('/services/serviceManagerCLI.js') || process.argv[1].endsWith('\\services\\serviceManagerCLI.js') || process.argv[1].endsWith('services\\serviceManagerCLI.js') || process.argv[1].endsWith('services/serviceManagerCLI.js'))) {
  main();
}

export default ServiceManager;
