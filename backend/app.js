import fs from "node:fs/promises";

import bodyParser from "body-parser";
import express from "express";

const app = express();

app.use(express.static("images"));
app.use(bodyParser.json());

// CORS

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // allow all domains
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  next();
});
 
app.get("/places", async (req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 3000));
 // return res.status (500).json(); 

  const fileContent = await fs.readFile("./data/places.json");

  const placesData = JSON.parse(fileContent);

  res.status(200).json({ places: placesData });
});

app.get("/user-places", async (req, res) => {
  const fileContent = await fs.readFile("./data/user-places.json");

  const places = JSON.parse(fileContent);

  res.status(200).json({ places });
});

app.put("/app-usage", async (req, res) => {
  const appId = req.body.appId;
  console.log('Received PUT request:', req.body);
  res.send({ message: 'Received PUT successfully' });


  const fileContent = await fs.readFile("./data/app-usage.json");
  const appData = JSON.parse(fileContent);
  const app = appData.find((app) => app.id === appId);
  console.log('app.id: ' + app.id);
  console.log('appData[0].usages ' + appData[0].usages.toString());
  console.log('appData[1].usages ' + appData[1].usages.toString());
  console.log('appData[2].usages ' + appData[2].usages.toString());
  console.log('appData[3].usages ' + appData[3].usages.toString());
  app.usages++;
  let updatedAppData = appData.filter(a => a.id !== app.id);
  updatedAppData = [...updatedAppData, app];
  console.log('updatedAppData[0].usages ' + updatedAppData[0].usages.toString());
  console.log('updatedAppData[1].usages ' + updatedAppData[1].usages.toString());
  console.log('updatedAppData[2].usages ' + updatedAppData[2].usages.toString());
  console.log('updatedAppData[3].usages ' + updatedAppData[3].usages.toString());

  await fs.writeFile(
    "./data/app-usage.json",
    JSON.stringify(updatedAppData)
  );

  //clearres.status(200).json({ appUsages: updatedAppData });
});

app.delete("/user-places/:id", async (req, res) => {
  const placeId = req.params.id;

  const userPlacesFileContent = await fs.readFile("./data/user-places.json");
  const userPlacesData = JSON.parse(userPlacesFileContent);

  const placeIndex = userPlacesData.findIndex((place) => place.id === placeId);

  let updatedUserPlaces = userPlacesData;

  if (placeIndex >= 0) {
    updatedUserPlaces.splice(placeIndex, 1);
  }

  await fs.writeFile(
    "./data/user-places.json",
    JSON.stringify(updatedUserPlaces)
  );

  res.status(200).json({ userPlaces: updatedUserPlaces });
});

// 404
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    return next();
  }
  res.status(404).json({ message: "404 - Not Found" });
});

app.listen(3000);
