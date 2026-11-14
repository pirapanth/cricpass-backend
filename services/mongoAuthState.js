const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const WhatsAppAuth = require('../models/WhatsAppAuth');

async function useMongoAuthState() {
  const readData = async (key) => {
    try {
      const doc = await WhatsAppAuth.findOne({ key });
      if (!doc) return null;
      return JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver);
    } catch (error) {
      return null;
    }
  };

  const writeData = async (key, data) => {
    try {
      const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
      await WhatsAppAuth.findOneAndUpdate(
        { key },
        { data: serialized },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`❌ [Auth Write Error] Key ${key}:`, error.message);
    }
  };

  const removeData = async (key) => {
    try {
      await WhatsAppAuth.deleteOne({ key });
    } catch (error) {}
  };

  // Properly initialize Baileys cryptographic credentials if none exist
  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData('creds', creds);
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = Buffer.from(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(key, value));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData('creds', state.creds);
    }
  };
}

module.exports = useMongoAuthState;