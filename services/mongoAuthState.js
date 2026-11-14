const mongoose = require('mongoose');

// Define a simple schema for WhatsApp Session Keys
const WhatsAppAuthSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true }
});

const WhatsAppAuth = mongoose.models.WhatsAppAuth || mongoose.model('WhatsAppAuth', WhatsAppAuthSchema);

async function useMongoAuthState() {
  const readData = async (key) => {
    try {
      const doc = await WhatsAppAuth.findOne({ key });
      if (!doc) return null;
      return JSON.parse(JSON.stringify(doc.data), (k, v) => {
        if (v !== null && typeof v === 'object' && v.type === 'Buffer') {
          return Buffer.from(v.data);
        }
        return v;
      });
    } catch (error) {
      return null;
    }
  };

  const writeData = async (key, data) => {
    try {
      const serialized = JSON.parse(JSON.stringify(data, (k, v) => {
        if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
          return { type: 'Buffer', data: Array.from(v) };
        }
        return v;
      }));

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

  const creds = (await readData('creds')) || {
    pairingCode: undefined,
    lastAccountSyncTimestamp: 0,
    creds: {}
  };

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