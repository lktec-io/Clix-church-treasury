import { env } from '../../config/env.js';
import { pool } from '../../config/db.js';
import { seedRbacCatalog } from './seedRbacCatalog.js';
import { seedDevTenant } from './seedDevTenant.js';

async function main() {
  const { permissionCount, roleCount } = await seedRbacCatalog();
  console.log(`Seeded ${permissionCount} permissions across ${roleCount} system roles.`);

  if (!env.isProduction) {
    const { tenant, admin, devPassword } = await seedDevTenant();
    console.log(`Dev tenant ready: "${tenant.name}" (slug: ${tenant.slug})`);
    console.log(`Dev admin: ${admin.email} / ${devPassword}`);
  } else {
    console.log('Skipping dev tenant seed in production.');
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  pool.end();
});
