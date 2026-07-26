const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
let db;

try {
  // Try service account first, fall back to application default
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
  const fs = require('fs');

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('[Cleanup] Initialized with service account key');
  } else {
    admin.initializeApp({
      projectId: 'subtick-bbd55',
    });
    console.log('[Cleanup] Initialized with application default credentials');
  }
  db = admin.firestore();

  // Connect to emulator if env var is set
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    db.settings({
      host: `${host}:${port}`,
      ssl: false,
    });
    console.log(`[Cleanup] Connected to Firestore emulator at ${host}:${port}`);
  }
} catch (error) {
  console.error('[Cleanup] Failed to initialize Firebase:', error.message);
  process.exit(1);
}

async function cleanup() {
  console.log('[Cleanup] Starting to clean up full-length bodyHtml from articles...');
  
  let totalProcessed = 0;
  let totalCleaned = 0;
  let totalErrors = 0;

  try {
    const articlesSnapshot = await db.collection('articles').get();
    
    if (articlesSnapshot.empty) {
      console.log('No articles found in the database.');
      return;
    }

    console.log(`Found ${articlesSnapshot.size} articles to process.`);

    for (const doc of articlesSnapshot.docs) {
      totalProcessed++;
      const data = doc.data();
      
      if (data.bodyHtml !== undefined) {
        try {
          await doc.ref.update({
            bodyHtml: admin.firestore.FieldValue.delete()
          });
          totalCleaned++;
          console.log(`  ✅ Removed bodyHtml from: ${doc.id} (${data.title ? data.title.substring(0, 30) : 'Untitled'}...)`);
        } catch (updateError) {
          totalErrors++;
          console.error(`  ❌ Error updating ${doc.id}:`, updateError.message);
        }
      }
    }
  } catch (error) {
    console.error('[Cleanup] Error fetching articles:', error);
  }

  console.log('\n============================================');
  console.log('[Cleanup] Complete!');
  console.log(`  Total Processed: ${totalProcessed}`);
  console.log(`  Total Cleaned: ${totalCleaned}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log('============================================');
  
  process.exit(0);
}

cleanup().catch(error => {
  console.error('[Cleanup] Fatal error:', error);
  process.exit(1);
});
