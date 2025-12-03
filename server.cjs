// ===============================
// Cardaris Portal API (server.cjs)
// ===============================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ===============================
// ENV
// ===============================
const PORT = process.env.PORT || 4000;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_TEST_CUSTOMER_ID = process.env.SHOPIFY_TEST_CUSTOMER_ID;

console.log("======================================");
console.log(" Cardaris Portal API - Configuration");
console.log("======================================");
console.log("[ENV] SHOPIFY_STORE_DOMAIN =", SHOPIFY_STORE_DOMAIN);
console.log("[ENV] SHOPIFY_ACCESS_TOKEN présent ?", SHOPIFY_ACCESS_TOKEN ? "OUI" : "NON");
console.log("[ENV] SHOPIFY_TEST_CUSTOMER_ID =", SHOPIFY_TEST_CUSTOMER_ID);
console.log("======================================");

// Client Axios vers Shopify Admin API
const shopify = SHOPIFY_STORE_DOMAIN && SHOPIFY_ACCESS_TOKEN
  ? axios.create({
      baseURL: `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10`,
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    })
  : null;

// Récupère l'ID client (priorité à ?customerId dans l'URL)
function getCustomerIdFromRequest(req) {
  return req.query.customerId || SHOPIFY_TEST_CUSTOMER_ID || null;
}

// Mapping Customer Shopify -> profil portail
function mapShopifyCustomerToProfile(c) {
  return {
    fullName: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
    email: c.email || "",
    nickname: c.note || "", // on utilise "note" comme pseudo client
    notifications: {
      orders: true,
      promos: true,
    },
    mode: "shopify",
  };
}

// ===============================
// ROUTE ROOT /
// ===============================
app.get("/", (req, res) => {
  res.json({
    name: "Cardaris Portal API",
    status: "ok",
    shopifyConfigured: Boolean(SHOPIFY_STORE_DOMAIN && SHOPIFY_ACCESS_TOKEN),
    testCustomerConfigured: Boolean(SHOPIFY_TEST_CUSTOMER_ID),
  });
});

// ===============================
// ROUTE HEALTH
// ===============================
app.get("/health", (req, res) => {
  res.json({
    name: "Cardaris Portal API",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// ===============================
// ROUTE PROFILE (lecture depuis Shopify)
// ===============================
app.get("/profile", async (req, res) => {
  try {
    if (!shopify) {
      return res.status(500).json({
        error: "Shopify non configuré (domaine ou token manquant).",
      });
    }

    const customerId = getCustomerIdFromRequest(req);
    if (!customerId) {
      return res.status(400).json({
        error:
          "Aucun customerId fourni. Utilise ?customerId=ID dans l'URL ou configure SHOPIFY_TEST_CUSTOMER_ID.",
      });
    }

    console.log("[/profile] Récupération du client Shopify ID =", customerId);

    const response = await shopify.get(`/customers/${customerId}.json`);
    const c = response.data.customer;

    console.log("[/profile] Données Shopify reçues (PII) :", {
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      note: c.note,
    });

    const profile = mapShopifyCustomerToProfile(c);
    console.log("[/profile] Profil mappé :", profile);

    res.json(profile);
  } catch (err) {
    console.error(
      "[/profile] Erreur",
      err.response?.status || "",
      err.response?.data || "",
      err.message
    );
    res.status(500).json({ error: "Erreur serveur /profile", details: err.message });
  }
});

// ===============================
// ROUTE PROFILE UPDATE (écriture Shopify)
// ===============================
app.post("/profile/update", async (req, res) => {
  try {
    if (!shopify) {
      return res.status(500).json({
        error: "Shopify non configuré (domaine ou token manquant).",
      });
    }

    const customerId = getCustomerIdFromRequest(req);
    if (!customerId) {
      return res.status(400).json({
        error:
          "Aucun customerId fourni. Utilise ?customerId=ID dans l'URL ou configure SHOPIFY_TEST_CUSTOMER_ID.",
      });
    }

    const { fullName, email, nickname, notifications } = req.body || {};
    console.log("[/profile/update] Payload reçu :", {
      fullName,
      email,
      nickname,
      notifications,
    });

    const [firstName, ...rest] = (fullName || "").split(" ");
    const lastName = rest.join(" ");

    const updatePayload = {
      customer: {
        id: customerId,
        first_name: firstName || null,
        last_name: lastName || null,
        email: email || null,
        note: nickname || "",
      },
    };

    console.log("[/profile/update] Payload envoyé à Shopify :", updatePayload);

    const response = await shopify.put(
      `/customers/${customerId}.json`,
      updatePayload
    );

    const updatedCustomer = response.data.customer;
    const mappedProfile = mapShopifyCustomerToProfile(updatedCustomer);

    console.log("[/profile/update] Client mis à jour, profil mappé :", mappedProfile);

    res.json({
      ok: true,
      profile: mappedProfile,
    });
  } catch (err) {
    console.error(
      "[/profile/update] Erreur",
      err.response?.status || "",
      err.response?.data || "",
      err.message
    );
    res.status(500).json({ error: "Erreur update profile", details: err.message });
  }
});

// ===============================
// ROUTE COMMANDES
// ===============================
app.get("/orders", async (req, res) => {
  try {
    if (!shopify) {
      return res.status(500).json({
        error: "Shopify non configuré (domaine ou token manquant).",
      });
    }

    const customerId = getCustomerIdFromRequest(req);
    if (!customerId) {
      console.error("[/orders] Aucun customerId fourni");
      return res.status(400).json({
        error:
          "Aucun customerId fourni. Utilise ?customerId=ID dans l'URL ou configure SHOPIFY_TEST_CUSTOMER_ID.",
      });
    }

    console.log("[/orders] Chargement des commandes pour client ID =", customerId);

    const response = await shopify.get(`/orders.json`, {
      params: {
        status: "any",
        customer_id: customerId,
      },
    });

    const orders = response.data.orders || [];
    console.log(`[/orders] ${orders.length} commande(s) trouvée(s).`);

    const data = orders.map((o) => ({
      id: `#CMD-${o.order_number}`,
      date: new Date(o.created_at).toLocaleDateString("fr-FR"),
      totalFormatted: `${o.total_price} €`,
      description: o.line_items[0]?.title || "Commande Cardaris",
      status: o.fulfillment_status ? o.fulfillment_status.toUpperCase() : "EN ATTENTE",
      statusVariant: "info",
    }));

    res.json(data);
  } catch (err) {
    console.error(
      "[/orders] error",
      err.response?.status || "",
      err.response?.data || "",
      err.message
    );
    res.status(500).json({ error: "Erreur chargement commandes", details: err.message });
  }
});

// ===============================
// ROUTE ADRESSES
// ===============================
app.get("/addresses", async (req, res) => {
  try {
    if (!shopify) {
      return res.status(500).json({
        error: "Shopify non configuré (domaine ou token manquant).",
      });
    }

    const customerId = getCustomerIdFromRequest(req);
    if (!customerId) {
      console.error("[/addresses] Aucun customerId fourni");
      return res.status(400).json({
        error:
          "Aucun customerId fourni. Utilise ?customerId=ID dans l'URL ou configure SHOPIFY_TEST_CUSTOMER_ID.",
      });
    }

    console.log("[/addresses] Chargement des adresses pour client ID =", customerId);

    const response = await shopify.get(`/customers/${customerId}/addresses.json`);
    const addresses = response.data.addresses || [];
    console.log(`[/addresses] ${addresses.length} adresse(s) trouvée(s).`);

    res.json(addresses);
  } catch (err) {
    console.error(
      "[/addresses] error",
      err.response?.status || "",
      err.response?.data || "",
      err.message
    );
    res.status(500).json({ error: "Erreur chargement adresses", details: err.message });
  }
});

// ===============================
// ROUTES TICKETS (MAQUETTE)
// ===============================
app.get("/tickets", (req, res) => {
  res.json([]);
});

app.post("/tickets/new", (req, res) => {
  console.log("[/tickets/new] Nouveau ticket (maquette) :", req.body);
  res.json({ ok: true });
});

// ===============================
// LANCEMENT SERVEUR
// ===============================
app.listen(PORT, () => {
  console.log(`Cardaris Portal API démarrée sur http://localhost:${PORT}`);
});
