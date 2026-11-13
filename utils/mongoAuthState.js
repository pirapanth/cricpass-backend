const mongoose = require('mongoose');
const { BufferJSON } = require('@whiskeysockets/baileys');

const baileysAuthSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true }
});

const BaileysAuth = mongoose.models.BaileysAuth || mongoose.model('BaileysAuth', baileysAuthSchema);

async function useMongoAuthState(sessionId = 'cricpass_main') {
  const readData = async (key) => {
    try {
      const doc = await BaileysAuth.findOne({ sessionId: `${sessionId}_${key}` });
      if (!doc || !doc.data) return null;
      return JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver);
    } catch (error) {
      console.warn(`⚠️ [BaileysAuth] Read error for ${key}:`, error.message);
      return null;
    }
  };

  const writeData = async (key, data) => {
    try {
      const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
      await BaileysAuth.findOneAndUpdate(
        { sessionId: `${sessionId}_${key}` },
        { data: serialized },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`❌ [BaileysAuth] Write error for ${key}:`, error.message);
    }
  };

  const removeData = async (key) => {
    try {
      await BaileysAuth.deleteOne({ sessionId: `${sessionId}_${key}` });
    } catch (error) {
      console.warn(`⚠️ [BaileysAuth] Remove error for ${key}:`, error.message);
    }
  };

  const creds = (await readData('creds')) || (await import('@whiskeysockets/baileys')).initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = await readData(`${type}-${id}`);
            if (value) data[id] = value;
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