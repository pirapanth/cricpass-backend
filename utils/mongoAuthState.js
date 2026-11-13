const BaileysAuth = require('../models/BaileysAuth');
const { BufferJSON } = require('@whiskeysockets/baileys');

async function useMongoAuthState(sessionId = 'cricpass_whatsapp_session') {
  // Helper to read from DB using BufferJSON reviver
  const readData = async (key) => {
    try {
      const doc = await BaileysAuth.findOne({ sessionId: `${sessionId}_${key}` });
      if (!doc) return null;
      return JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver);
    } catch (error) {
      console.error(`❌ [BaileysAuth] Failed to read ${key}:`, error.message);
      return null;
    }
  };

  // Helper to write to DB using BufferJSON replacer
  const writeData = async (key, data) => {
    try {
      const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
      await BaileysAuth.findOneAndUpdate(
        { sessionId: `${sessionId}_${key}` },
        { data: serialized },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`❌ [BaileysAuth] Failed to write ${key}:`, error.message);
    }
  };

  // Helper to delete from DB
  const removeData = async (key) => {
    try {
      await BaileysAuth.deleteOne({ sessionId: `${sessionId}_${key}` });
    } catch (error) {
      console.error(`❌ [BaileysAuth] Failed to remove ${key}:`, error.message);
    }
  };

  // Load initial credentials
  const creds = (await readData('creds')) || (await import('@whiskeysockets/baileys')).initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = await readData(`${type}-${id}`);
            if (value) {
              data[id] = value;
            }
          }
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              if (value) {
                tasks.push(writeData(`${category}-${id}`, value));
              } else {
                tasks.push(removeData(`${category}-${id}`));
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

module.exports = { useMongoAuthState };