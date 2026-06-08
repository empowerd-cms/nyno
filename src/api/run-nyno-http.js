import { runYamlString,emitEvent} from './../lib-manual/runYamlString.js';
import { loadNynoEnv } from './../lib-manual/env.js';
const envs = loadNynoEnv({ requireRuntime: true });

export default function register(app) {

  // TEST TODO for receiving events from other processes
  app.post('/event/:name' , async(req,res) => {
      if(!envs.SECRET) {
        return res.status(401).json({ error: 'Security secret must be set in .env' });
      }

      if (req.query.secret !== envs.SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = req.body ?? {};
      emitEvent(req.params.name ?? '?',data);
      res.json({"status":"OK"});
  });

  app.get('/event/:name' , async(req,res) => {
      if(!envs.SECRET) {
        return res.status(401).json({ error: 'Security secret must be set in .env' });
      }

      if (req.query.secret !== envs.SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const data = {};
      emitEvent(req.params.name ?? '?',data);
      res.json({"status":"OK"});
  });

  // for "Run Workflow" via HTTP(s) GUI 
  app.post('/run-nyno-http', async(req, res) => {
    if(!envs.SECRET) {
      return res.status(401).json({ error: 'Security secret must be set in .env' });
    }
    if (req.headers.authorization !== envs.SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const text = req.body.text;
    const result = await runYamlString(text);
    res.json(result);
  });
}
