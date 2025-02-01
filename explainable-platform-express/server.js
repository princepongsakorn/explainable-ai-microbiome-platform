const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json()); 

const INGRESS_URL = "http://127.0.0.1:8080"; 
const HOST_HEADER = "kserve-custom-model.default.example.com"; 

app.use("/api", async (req, res) => {
  try {
    const response = await axios({
      method: req.method,
      url: `${INGRESS_URL}${req.originalUrl.replace("/api", "")}`, 
      data: req.body,
      headers: {
        "Host": HOST_HEADER,
        "Content-Type": "application/json"
      }
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error("Proxy Error:", error.message);
    console.error("Proxy Error:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🚀 Express Proxy running at http://localhost:${PORT}`);
});