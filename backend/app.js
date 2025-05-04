import fs from "node:fs/promises";

import bodyParser from "body-parser";
import express from "express";

const app = express();
app.use(bodyParser.json());

// CORS

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // allow all domains
  res.setHeader("Access-Control-Allow-Methods", "PUT");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  next();
});
 

app.put("/app-usage", async (req, res) => {
  try {
    const appId = req.body.appId;
  
    console.log('Received PUT request:', req.body);
  
    const fileContent = await fs.readFile("./data/app-usage.json");
    const appData = JSON.parse(fileContent);
    const app = appData.find((app) => app.id === appId);
  
    if (!app) {
      return res.status(404).json({ error: 'App ID not found' });
    }
  
    console.log('app.id: ' + app.id);
    app.usages++;
    let updatedAppData = appData.filter(a => a.id !== app.id);
    updatedAppData = [...updatedAppData, app];


    await fs.writeFile(
      "./data/app-usage.json",
      JSON.stringify(updatedAppData)
    );

    res.status(200).json({ message: 'Received PUT successfully' });
} catch (err) {
    console.error("Error in /app-usage:", err);
    res.status(500).json({ error: 'Internal server error' });
}
  
});


app.listen(3000);
