import { app } from "./app";
import { config } from "./config";

app.listen(config.port, () => {
  console.log(`AuraKeeper backend listening on port ${config.port}`);
});
