require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error(
    "Missing MONGODB_URI. Please set it in .env or Render Environment Variables."
  );
  process.exit(1);
}

/* ===================== MONGODB CONNECT ===================== */

mongoose
  .connect(MONGODB_URI, {
    dbName: "tripmate",
  })
  .then(() => console.log("MongoDB connected successfully!"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

/* ============================================================
   TRIPMATE BACKEND
   Collaborative Trip Notes + Plan Maker
   ============================================================ */

/* ===================== CONSTANTS ===================== */

const DEFAULT_CATEGORIES = [
  "Shopping",
  "Transport",
  "Hotel",
  "Food",
  "Personal",
  "General",
];

const MAX_CATEGORIES_PER_TRIP = 20;

const PLAN_TYPES = [
  "place",
  "food",
  "task",
  "rest",
  "transport",
  "hotel",
  "custom",
];

/* ===================== HELPERS ===================== */

function now() {
  return Date.now();
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeUserId(value = "") {
  return String(value || "").trim();
}

function uniqueStrings(list = []) {
  return [...new Set((list || []).map((x) => normalizeText(x)).filter(Boolean))];
}

function normalizeCategory(value = "") {
  const text = normalizeText(value);
  return text || "General";
}

function createInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function generateUniqueInviteCode() {
  let code = createInviteCode();
  let exists = await Trip.findOne({ inviteCode: code });

  while (exists) {
    code = createInviteCode();
    exists = await Trip.findOne({ inviteCode: code });
  }

  return code;
}

function getTripUsers(trip) {
  return uniqueStrings([trip.ownerId, ...(trip.members || [])]);
}

function canAccessTrip(trip, userId) {
  if (!userId) return true;
  const users = getTripUsers(trip);
  return users.includes(userId);
}

function ensureCategoryExists(trip, category) {
  const finalCategory = normalizeCategory(category);

  const allCategories = uniqueStrings([
    ...DEFAULT_CATEGORIES,
    ...(trip.customCategories || []),
  ]);

  if (allCategories.includes(finalCategory)) {
    return finalCategory;
  }

  const currentTotal = allCategories.length;

  if (currentTotal >= MAX_CATEGORIES_PER_TRIP) {
    const error = new Error(`Maximum ${MAX_CATEGORIES_PER_TRIP} categories per trip`);
    error.statusCode = 400;
    throw error;
  }

  trip.customCategories = uniqueStrings([
    ...(trip.customCategories || []),
    finalCategory,
  ]);

  return finalCategory;
}

function toPublicUser(user) {
  return {
    userId: user.userId,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function buildChecklistItem({
  text,
  title,
  content = "",
  category = "General",
  assignedTo = "",
  userId = "",
  sourceType = "manual",
  sourceName = "",
  reminderId = "",
}) {
  const finalText = normalizeText(text || title);

  return {
    title: normalizeText(title || finalText),
    text: finalText,
    content: normalizeText(content),
    category: normalizeCategory(category),
    done: false,
    assignedTo: normalizeUserId(assignedTo),
    reminderId: normalizeText(reminderId),
    sourceType: normalizeText(sourceType || "manual"),
    sourceName: normalizeText(sourceName),
    updatedBy: normalizeUserId(userId),
    createdBy: normalizeUserId(userId),
    createdAt: now(),
    updatedAt: now(),
  };
}

/* ===================== SEARCH HELPERS ===================== */

function removeVietnameseTones(str = "") {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function searchMatch(name, query) {
  const n = removeVietnameseTones(name);
  const q = removeVietnameseTones(query);
  return n.includes(q);
}

function searchScore(name, query) {
  const n = removeVietnameseTones(name);
  const q = removeVietnameseTones(query);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return 99;
}

/* ===================== SCHEMAS ===================== */

const ChecklistItemSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    text: { type: String, required: true },
    content: { type: String, default: "" },

    category: { type: String, default: "General" },
    done: { type: Boolean, default: false },

    assignedTo: { type: String, default: "" },

    reminderId: { type: String, default: "" },
    sourceType: { type: String, default: "manual" },
    sourceName: { type: String, default: "" },

    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },

    createdAt: { type: Number, default: Date.now },
    updatedAt: { type: Number, default: Date.now },
  },
  { _id: true }
);

const PlaceSchema = new mongoose.Schema(
  {
    name: String,
    type: String,
    reason: String,
    estimatedCost: String,
    address: String,
    latitude: Number,
    longitude: Number,
  },
  { _id: false }
);

const RatingSchema = new mongoose.Schema(
  {
    placeName: { type: String, required: true },
    destination: { type: String, default: "" },

    userId: { type: String, required: true },
    score: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, default: "" },
    imageUrls: { type: [String], default: [] },

    // Dataset source:
    // location_reminder = user review sau khi arrived
    // plan_done = user review sau khi hoàn thành plan item
    // manual = fallback/demo
    source: {
      type: String,
      default: "manual",
      enum: ["location_reminder", "plan_done", "manual"],
    },

    reminderId: { type: String, default: "" },
    checklistItemId: { type: String, default: "" },
    planItemId: { type: String, default: "" },

    tripStatusAtReview: { type: String, default: "" },
    createdAt: { type: Number, default: Date.now },
  },
  { _id: true }
);

const LocationReminderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, default: "" },

    checklistItemId: { type: String, default: "" },

    locationName: { type: String, default: "" },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    radiusMeters: { type: Number, default: 200 },

    enabled: { type: Boolean, default: true },
    triggered: { type: Boolean, default: false },

    createdBy: { type: String, default: "" },
    triggeredBy: { type: String, default: "" },

    createdAt: { type: Number, default: Date.now },
    triggeredAt: Number,
    updatedAt: { type: Number, default: Date.now },
  },
  { _id: true }
);

const PlanItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    note: { type: String, default: "" },

    type: {
      type: String,
      default: "custom",
      enum: PLAN_TYPES,
    },

    startTime: { type: String, required: true },
    endTime: { type: String, default: "" },

    locationName: { type: String, default: "" },
    latitude: Number,
    longitude: Number,

    assignedTo: { type: String, default: "" },

    sourceChecklistId: { type: String, default: "" },
    sourceName: { type: String, default: "" },

    done: { type: Boolean, default: false },

    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },

    createdAt: { type: Number, default: Date.now },
    updatedAt: { type: Number, default: Date.now },
  },
  { _id: true }
);

const TripSchema = new mongoose.Schema({
  destination: { type: String, required: true },
  title: { type: String, required: true },

  ownerId: { type: String, required: true },
  members: { type: [String], default: [] },

  inviteCode: { type: String, unique: true, sparse: true },

  note: { type: String, default: "" },
  status: {
    type: String,
    default: "planning",
    enum: ["planning", "finished", "cancelled"],
  },

  tags: { type: [String], default: ["Travel"] },

  defaultCategories: { type: [String], default: DEFAULT_CATEGORIES },
  customCategories: { type: [String], default: [] },

  places: { type: [PlaceSchema], default: [] },
  foods: { type: [PlaceSchema], default: [] },

  checklist: { type: [ChecklistItemSchema], default: [] },
  planItems: { type: [PlanItemSchema], default: [] },

  ratings: { type: [RatingSchema], default: [] },

  locationReminders: { type: [LocationReminderSchema], default: [] },

  reminderTitle: String,
  latitude: Number,
  longitude: Number,
  locationName: String,

  updatedBy: String,
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
});

const Trip = mongoose.model("Trip", TripSchema);

/* ===================== SIMPLE AUTH SCHEMA ===================== */

const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  displayName: { type: String, default: "" },
  password: { type: String, required: true },
  email: { type: String, default: "" },
  avatarColor: { type: String, default: "#1E88E5" },
  createdAt: { type: Number, default: Date.now },
  lastLoginAt: Number,
});

const User = mongoose.model("User", UserSchema);

/* ===================== TRIP SHARE REQUEST SCHEMA ===================== */

const TripShareRequestSchema = new mongoose.Schema({
  tripId: { type: String, required: true },

  fromUserId: { type: String, required: true },
  toUserId: { type: String, required: true },

  type: {
    type: String,
    default: "join",
    enum: ["join", "share"],
  },

  inviteCode: { type: String, default: "" },

  status: {
    type: String,
    default: "pending",
    enum: ["pending", "accepted", "rejected"],
  },

  message: { type: String, default: "" },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
});

const TripShareRequest = mongoose.model(
  "TripShareRequest",
  TripShareRequestSchema
);

/* ===================== MOCK RECOMMENDATION DATA ===================== */

const recommendationData = {
  "vũng tàu": {
    destination: "Vũng Tàu",
    intro:
      "Trip biển ngắn ngày, phù hợp đi cuối tuần, ăn hải sản và check-in ven biển.",
    places: [
      {
        name: "Bãi Sau",
        type: "beach",
        reason: "Bãi biển phổ biến, dễ tắm biển và đi dạo buổi chiều.",
        estimatedCost: "Free",
      },
      {
        name: "Tượng Chúa Kitô Vua",
        type: "landmark",
        reason: "Điểm check-in nổi tiếng, có thể nhìn toàn cảnh thành phố.",
        estimatedCost: "Free",
      },
      {
        name: "Mũi Nghinh Phong",
        type: "landmark",
        reason: "View biển đẹp, hợp chụp ảnh nhóm.",
        estimatedCost: "Free",
      },
      {
        name: "Ngọn hải đăng Vũng Tàu",
        type: "landmark",
        reason: "Đường lên đẹp, ngắm thành phố từ trên cao.",
        estimatedCost: "Free",
      },
    ],
    foods: [
      {
        name: "Bánh khọt",
        type: "food",
        reason: "Món đặc trưng nên thử khi tới Vũng Tàu.",
        estimatedCost: "50k - 100k/người",
      },
      {
        name: "Hải sản",
        type: "food",
        reason: "Phù hợp ăn nhóm sau khi đi biển.",
        estimatedCost: "150k - 300k/người",
      },
      {
        name: "Lẩu cá đuối",
        type: "food",
        reason: "Món tối phổ biến, dễ ăn theo nhóm.",
        estimatedCost: "100k - 200k/người",
      },
    ],
    checklist: [
      { text: "Mua nước uống", category: "Shopping" },
      { text: "Mua snack / đồ ăn nhẹ", category: "Shopping" },
      { text: "Chuẩn bị kem chống nắng", category: "Personal" },
      { text: "Mang sạc dự phòng", category: "Personal" },
      { text: "Kiểm tra vé xe / lịch chạy xe", category: "Transport" },
      { text: "Đặt khách sạn hoặc homestay", category: "Hotel" },
      { text: "Lưu địa chỉ quán ăn muốn thử", category: "Food" },
    ],
  },

  "đà lạt": {
    destination: "Đà Lạt",
    intro: "Trip nghỉ dưỡng, cafe, chụp ảnh và ăn uống trong thời tiết se lạnh.",
    places: [
      {
        name: "Hồ Xuân Hương",
        type: "landmark",
        reason: "Dễ đi dạo, nằm ở trung tâm.",
        estimatedCost: "Free",
      },
      {
        name: "Quảng trường Lâm Viên",
        type: "landmark",
        reason: "Biểu tượng Đà Lạt, tiện check-in.",
        estimatedCost: "Free",
      },
      {
        name: "Chợ Đà Lạt",
        type: "shopping",
        reason: "Ăn vặt và mua quà.",
        estimatedCost: "50k - 200k/người",
      },
      {
        name: "Kombi Land",
        type: "cafe",
        reason: "Không gian chụp ảnh đẹp.",
        estimatedCost: "100k - 200k/người",
      },
    ],
    foods: [
      {
        name: "Bánh căn",
        type: "food",
        reason: "Món sáng phổ biến ở Đà Lạt.",
        estimatedCost: "40k - 80k/người",
      },
      {
        name: "Lẩu gà lá é",
        type: "food",
        reason: "Hợp thời tiết lạnh, ăn nhóm tốt.",
        estimatedCost: "100k - 200k/người",
      },
      {
        name: "Sữa đậu nành nóng",
        type: "food",
        reason: "Trải nghiệm tối đặc trưng.",
        estimatedCost: "20k - 50k/người",
      },
    ],
    checklist: [
      { text: "Chuẩn bị áo khoác", category: "Personal" },
      { text: "Đặt phòng trước", category: "Hotel" },
      { text: "Mang thuốc say xe", category: "Personal" },
      { text: "Lưu địa điểm thuê xe máy", category: "Transport" },
      { text: "Chuẩn bị pin dự phòng", category: "Personal" },
      { text: "Lên lịch các quán cafe muốn đi", category: "Food" },
    ],
  },

  "nha trang": {
    destination: "Nha Trang",
    intro: "Trip biển, đảo, hải sản và hoạt động ngoài trời.",
    places: [
      {
        name: "Bãi biển Nha Trang",
        type: "beach",
        reason: "Dễ đi, phù hợp tắm biển và đi dạo.",
        estimatedCost: "Free",
      },
      {
        name: "VinWonders Nha Trang",
        type: "landmark",
        reason: "Khu vui chơi lớn, phù hợp đi nhóm.",
        estimatedCost: "500k - 900k/người",
      },
      {
        name: "Tháp Bà Ponagar",
        type: "landmark",
        reason: "Địa điểm văn hóa nổi tiếng.",
        estimatedCost: "30k - 50k",
      },
    ],
    foods: [
      {
        name: "Bún cá Nha Trang",
        type: "food",
        reason: "Món địa phương dễ ăn.",
        estimatedCost: "40k - 80k/người",
      },
      {
        name: "Hải sản",
        type: "food",
        reason: "Phù hợp ăn tối theo nhóm.",
        estimatedCost: "150k - 300k/người",
      },
    ],
    checklist: [
      { text: "Chuẩn bị đồ bơi", category: "Personal" },
      { text: "Mua kem chống nắng", category: "Shopping" },
      { text: "Đặt khách sạn gần biển", category: "Hotel" },
      { text: "Kiểm tra vé máy bay / vé xe", category: "Transport" },
      { text: "Mang túi chống nước", category: "Personal" },
    ],
  },
};

/* ===================== RECOMMENDATION HELPERS ===================== */

function normalizeDestination(value = "") {
  return value.trim().toLowerCase();
}

function buildFallbackRecommendation(destination) {
  return {
    destination,
    intro: `Gợi ý nhanh cho chuyến đi ${destination}. Sau này có thể thay bằng ChatGPT API hoặc recommendation engine.`,
    places: [
      {
        name: `Trung tâm ${destination}`,
        type: "landmark",
        reason: "Điểm bắt đầu dễ tìm và thuận tiện.",
        estimatedCost: "Free",
      },
      {
        name: `Chợ / khu ăn uống ở ${destination}`,
        type: "food",
        reason: "Dễ tìm món địa phương.",
        estimatedCost: "50k - 200k/người",
      },
      {
        name: `Địa điểm check-in nổi bật tại ${destination}`,
        type: "landmark",
        reason: "Phù hợp đi nhóm và chụp ảnh.",
        estimatedCost: "Free - 100k",
      },
    ],
    foods: [
      {
        name: "Món địa phương nổi bật",
        type: "food",
        reason: "Nên thử để có trải nghiệm địa phương.",
        estimatedCost: "50k - 150k/người",
      },
      {
        name: "Quán cafe gần trung tâm",
        type: "cafe",
        reason: "Phù hợp nghỉ chân và họp nhóm.",
        estimatedCost: "40k - 100k/người",
      },
    ],
    checklist: [
      { text: "Kiểm tra phương tiện di chuyển", category: "Transport" },
      { text: "Đặt chỗ ở nếu đi qua đêm", category: "Hotel" },
      { text: "Chuẩn bị giấy tờ cá nhân", category: "Personal" },
      { text: "Mua nước uống và snack", category: "Shopping" },
      { text: "Lưu các địa điểm muốn đi", category: "General" },
    ],
  };
}

function getRecommendation(destination) {
  const key = normalizeDestination(destination);
  return recommendationData[key] || buildFallbackRecommendation(destination);
}

/* ===================== HEALTH CHECK ===================== */

app.get("/", (req, res) => {
  res.json({
    app: "TripMate Backend",
    status: "running",
    message: "Use /health, /suggestions, /trips APIs",
  });
});

app.get("/health", (req, res) => {
  res.json({
    app: "TripMate",
    status: "ok",
    time: Date.now(),
  });
});

/* ===================== SUGGESTIONS API ===================== */

app.get("/suggestions", (req, res) => {
  const destination = req.query.destination || "";

  if (!destination.trim()) {
    return res.status(400).json({
      message: "destination is required",
    });
  }

  const suggestion = getRecommendation(destination);
  res.json(suggestion);
});

/* ===================== SEARCH API ===================== */

app.get("/search", async (req, res) => {
  try {
    const q = normalizeText(req.query.q);

    if (!q || q.length < 1) {
      return res.json([]);
    }

    const results = [];

    // Scan recommendationData
    for (const key of Object.keys(recommendationData)) {
      const suggestion = recommendationData[key];
      const destination = suggestion.destination;

      // Destination match
      if (searchMatch(destination, q)) {
        results.push({
          type: "destination",
          name: destination,
          destination,
          subtitle: "Smart suggestion destination",
          estimatedCost: "",
          reason: suggestion.intro || "",
          ratingAverage: 0,
          ratingCount: 0,
          score: searchScore(destination, q),
        });
      }

      // Places match
      for (const place of suggestion.places || []) {
        if (searchMatch(place.name, q)) {
          results.push({
            type: "place",
            name: place.name,
            destination,
            subtitle: `${place.type || "place"} · ${destination}`,
            estimatedCost: place.estimatedCost || "",
            reason: place.reason || "",
            ratingAverage: 0,
            ratingCount: 0,
            score: searchScore(place.name, q),
          });
        }
      }

      // Foods match
      for (const food of suggestion.foods || []) {
        if (searchMatch(food.name, q)) {
          results.push({
            type: "food",
            name: food.name,
            destination,
            subtitle: `food · ${destination}`,
            estimatedCost: food.estimatedCost || "",
            reason: food.reason || "",
            ratingAverage: 0,
            ratingCount: 0,
            score: searchScore(food.name, q),
          });
        }
      }
    }

    // Deduplicate by name+type
    const seen = new Set();
    const deduped = [];
    for (const item of results) {
      const key = `${item.type}:${item.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }

    // Sort: exact match > startsWith > contains
    deduped.sort((a, b) => a.score - b.score);

    // Fetch ratings from all trips
    const allNames = deduped.map((r) => r.name);
    let ratingMap = {};
    if (allNames.length > 0) {
      const agg = await Trip.aggregate([
        { $unwind: "$ratings" },
        { $match: { "ratings.placeName": { $in: allNames } } },
        {
          $group: {
            _id: "$ratings.placeName",
            averageScore: { $avg: "$ratings.score" },
            totalReviews: { $sum: 1 },
          },
        },
      ]);
      for (const item of agg) {
        ratingMap[item._id] = {
          averageScore: item.averageScore,
          totalReviews: item.totalReviews,
        };
      }
    }

    const enriched = deduped.map((item) => {
      const r = ratingMap[item.name];
      return {
        type: item.type,
        name: item.name,
        destination: item.destination,
        subtitle: item.subtitle,
        estimatedCost: item.estimatedCost,
        reason: item.reason,
        ratingAverage: r ? parseFloat(r.averageScore.toFixed(1)) : 0,
        ratingCount: r ? r.totalReviews : 0,
      };
    });

    res.json(enriched.slice(0, 10));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ===================== SIMPLE AUTH APIs ===================== */

app.post("/auth/signup", async (req, res) => {
  try {
    const { userId, displayName = "", password, email = "" } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        message: "userId and password are required",
      });
    }

    const normalizedUserId = normalizeUserId(userId);

    const existingUser = await User.findOne({
      userId: normalizedUserId,
    });

    if (existingUser) {
      return res.status(409).json({
        message: "User already exists",
      });
    }

    const user = new User({
      userId: normalizedUserId,
      displayName: displayName || normalizedUserId,
      password,
      email,
      createdAt: now(),
    });

    await user.save();

    res.status(201).json({
      message: "Signup successful",
      user: toPublicUser(user),
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        message: "userId and password are required",
      });
    }

    const user = await User.findOne({
      userId: normalizeUserId(userId),
    });

    if (!user || user.password !== password) {
      return res.status(401).json({
        message: "Invalid userId or password",
      });
    }

    user.lastLoginAt = now();
    await user.save();

    res.json({
      message: "Login successful",
      user: toPublicUser(user),
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/users", async (req, res) => {
  try {
    const users = await User.find()
      .select("userId displayName avatarColor email createdAt lastLoginAt")
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/users/:userId", async (req, res) => {
  try {
    const user = await User.findOne({ userId: normalizeUserId(req.params.userId) })
      .select("userId displayName avatarColor email createdAt lastLoginAt");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== TRIP APIs ===================== */

app.post("/trips/from-suggestion", async (req, res) => {
  try {
    const {
      destination,
      userId,
      title,
      memberIds = [],
      note = "",
      selectedChecklist,
      uncheckedTexts = [],
    } = req.body;

    if (!destination || !userId) {
      return res.status(400).json({
        message: "destination and userId are required",
      });
    }

    const suggestion = getRecommendation(destination);
    const finalMembers = uniqueStrings(memberIds).filter((id) => id !== userId);
    const inviteCode = await generateUniqueInviteCode();

    let checklistSource = suggestion.checklist;

    if (Array.isArray(selectedChecklist)) {
      checklistSource = selectedChecklist;
    } else if (Array.isArray(uncheckedTexts) && uncheckedTexts.length > 0) {
      const uncheckedSet = new Set(uncheckedTexts.map((x) => normalizeText(x)));
      checklistSource = suggestion.checklist.filter(
        (item) => !uncheckedSet.has(normalizeText(item.text))
      );
    }

    const trip = new Trip({
      destination: suggestion.destination,
      title: title || `Trip to ${suggestion.destination}`,
      ownerId: normalizeUserId(userId),
      members: finalMembers,
      inviteCode,
      note: note || suggestion.intro,
      status: "planning",
      tags: ["Travel"],
      defaultCategories: DEFAULT_CATEGORIES,
      customCategories: [],
      places: suggestion.places,
      foods: suggestion.foods,
      checklist: checklistSource.map((item) =>
        buildChecklistItem({
          text: item.text,
          title: item.title || item.text,
          content: item.content || "",
          category: item.category || "General",
          userId,
          sourceType: "suggestion",
        })
      ),
      planItems: [],
      updatedBy: userId,
      createdAt: now(),
      updatedAt: now(),
    });

    await trip.save();

    res.status(201).json(trip);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
});

app.get("/trips", async (req, res) => {
  try {
    const userId = normalizeUserId(req.query.userId);

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const trips = await Trip.find({
      $or: [{ ownerId: userId }, { members: userId }],
    }).sort({ updatedAt: -1 });

    res.json(trips);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/trips/:id", async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.put("/trips/:id", async (req, res) => {
  try {
    const {
      title,
      note,
      members,
      status,
      tags,
      customCategories,
      defaultCategories,
      planItems,
      places,
      foods,
      updatedBy = "",
    } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    if (title !== undefined) trip.title = normalizeText(title) || trip.title;
    if (note !== undefined) trip.note = String(note || "");
    if (Array.isArray(members)) {
      trip.members = uniqueStrings(members).filter((id) => id !== trip.ownerId);
    }
    if (status !== undefined) {
      const allowedStatus = ["planning", "finished", "cancelled"];
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({
          message: "Invalid status",
        });
      }
      trip.status = status;
    }
    if (Array.isArray(tags)) trip.tags = uniqueStrings(tags);
    if (Array.isArray(defaultCategories)) {
      trip.defaultCategories = uniqueStrings(defaultCategories);
    }
    if (Array.isArray(customCategories)) {
      const cleanCategories = uniqueStrings(customCategories);

      if (cleanCategories.length + DEFAULT_CATEGORIES.length > MAX_CATEGORIES_PER_TRIP) {
        return res.status(400).json({
          message: `Maximum ${MAX_CATEGORIES_PER_TRIP} categories per trip`,
        });
      }

      trip.customCategories = cleanCategories;
    }
    if (Array.isArray(planItems)) {
      trip.planItems = planItems.map((item) => ({
        title: normalizeText(item.title),
        note: normalizeText(item.note),
        type: PLAN_TYPES.includes(item.type) ? item.type : "custom",
        startTime: normalizeText(item.startTime),
        endTime: normalizeText(item.endTime),
        locationName: normalizeText(item.locationName),
        latitude: item.latitude,
        longitude: item.longitude,
        assignedTo: normalizeUserId(item.assignedTo),
        sourceChecklistId: normalizeText(item.sourceChecklistId),
        sourceName: normalizeText(item.sourceName),
        done: !!item.done,
        createdBy: normalizeUserId(item.createdBy || updatedBy),
        updatedBy: normalizeUserId(updatedBy),
        createdAt: item.createdAt || now(),
        updatedAt: now(),
      })).filter((item) => item.title && item.startTime);
    }
    if (Array.isArray(places)) trip.places = places;
    if (Array.isArray(foods)) trip.foods = foods;

    trip.updatedBy = updatedBy || trip.updatedBy;
    trip.updatedAt = now();

    await trip.save();

    res.json(trip);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
});

app.delete("/trips/:id", async (req, res) => {
  try {
    const deleted = await Trip.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json({
      message: "Trip deleted",
      id: req.params.id,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== TRIP CATEGORIES ===================== */

app.get("/trips/:id/categories", async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const categories = uniqueStrings([
      ...(trip.defaultCategories || DEFAULT_CATEGORIES),
      ...(trip.customCategories || []),
    ]);

    res.json({
      maxCategories: MAX_CATEGORIES_PER_TRIP,
      defaultCategories: trip.defaultCategories || DEFAULT_CATEGORIES,
      customCategories: trip.customCategories || [],
      categories,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/trips/:id/categories", async (req, res) => {
  try {
    const { category, userId = "" } = req.body;

    if (!category) {
      return res.status(400).json({
        message: "category is required",
      });
    }

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const cleanCategory = normalizeCategory(category);

    const allCategories = uniqueStrings([
      ...(trip.defaultCategories || DEFAULT_CATEGORIES),
      ...(trip.customCategories || []),
    ]);

    if (allCategories.includes(cleanCategory)) {
      return res.status(409).json({
        message: "Category already exists",
        category: cleanCategory,
        trip,
      });
    }

    if (allCategories.length >= MAX_CATEGORIES_PER_TRIP) {
      return res.status(400).json({
        message: `Maximum ${MAX_CATEGORIES_PER_TRIP} categories per trip`,
      });
    }

    trip.customCategories = uniqueStrings([
      ...(trip.customCategories || []),
      cleanCategory,
    ]);

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.status(201).json({
      message: "Category added",
      category: cleanCategory,
      trip,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
});

app.delete("/trips/:id/categories/:categoryName", async (req, res) => {
  try {
    const { userId = "", moveTasksTo = "General" } = req.body || {};
    const categoryName = normalizeCategory(req.params.categoryName);

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const defaultCategories = trip.defaultCategories || DEFAULT_CATEGORIES;

    if (defaultCategories.includes(categoryName)) {
      return res.status(400).json({
        message: "Default category cannot be deleted",
      });
    }

    trip.customCategories = (trip.customCategories || []).filter(
      (cat) => cat !== categoryName
    );

    const targetCategory = normalizeCategory(moveTasksTo);

    trip.checklist.forEach((item) => {
      if (item.category === categoryName) {
        item.category = targetCategory;
        item.updatedBy = userId;
        item.updatedAt = now();
      }
    });

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json({
      message: "Category deleted. Tasks were moved to another category.",
      deletedCategory: categoryName,
      moveTasksTo: targetCategory,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== TRIP SHARING / INVITE ===================== */

function buildTripRequestDTO(request, trip) {
  return {
    _id: request._id,
    tripId: request.tripId,
    tripTitle: trip ? trip.title : "",
    destination: trip ? trip.destination : "",
    fromUserId: request.fromUserId,
    toUserId: request.toUserId,
    type: request.type || "join",
    inviteCode: request.inviteCode || "",
    status: request.status,
    message: request.message || "",
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

async function createJoinRequestByInviteCode({ inviteCode, userId, message = "" }) {
  const cleanInviteCode = String(inviteCode || "").trim().toUpperCase();
  const cleanUserId = normalizeUserId(userId);

  if (!cleanInviteCode || !cleanUserId) {
    const error = new Error("inviteCode and userId are required");
    error.statusCode = 400;
    throw error;
  }

  const trip = await Trip.findOne({
    inviteCode: cleanInviteCode,
  });

  if (!trip) {
    const error = new Error("Invalid invite code");
    error.statusCode = 404;
    throw error;
  }

  if (trip.ownerId === cleanUserId) {
    const error = new Error("You are already the owner of this trip");
    error.statusCode = 400;
    throw error;
  }

  if ((trip.members || []).includes(cleanUserId)) {
    const error = new Error("You are already a member of this trip");
    error.statusCode = 409;
    throw error;
  }

  const existingPending = await TripShareRequest.findOne({
    tripId: String(trip._id),
    fromUserId: cleanUserId,
    toUserId: trip.ownerId,
    type: "join",
    status: "pending",
  });

  if (existingPending) {
    const error = new Error("Join request already pending");
    error.statusCode = 409;
    error.request = existingPending;
    throw error;
  }

  const request = new TripShareRequest({
    tripId: String(trip._id),
    fromUserId: cleanUserId,
    toUserId: trip.ownerId,
    type: "join",
    inviteCode: trip.inviteCode,
    status: "pending",
    message: message || "",
    createdAt: now(),
    updatedAt: now(),
  });

  await request.save();

  return {
    request,
    trip,
  };
}

app.get("/trips/:id/invite-code", async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    if (!trip.inviteCode) {
      trip.inviteCode = await generateUniqueInviteCode();
      trip.updatedAt = now();
      await trip.save();
    }

    res.json({
      tripId: trip._id,
      inviteCode: trip.inviteCode,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/trips/join-request", async (req, res) => {
  try {
    const { inviteCode, userId, message = "" } = req.body;

    const { request, trip } = await createJoinRequestByInviteCode({
      inviteCode,
      userId,
      message,
    });

    res.status(201).json({
      message: "Join request sent",
      request,
      trip: {
        _id: trip._id,
        title: trip.title,
        destination: trip.destination,
        ownerId: trip.ownerId,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
      request: err.request,
    });
  }
});

// Backward compatible endpoint.
// Trước đây endpoint này join thẳng.
// Bây giờ đổi thành gửi join request để owner duyệt.
app.post("/trips/join-by-code", async (req, res) => {
  try {
    const { inviteCode, userId, message = "" } = req.body;

    const { request, trip } = await createJoinRequestByInviteCode({
      inviteCode,
      userId,
      message,
    });

    res.status(201).json({
      message: "Join request sent",
      request,
      trip: {
        _id: trip._id,
        title: trip.title,
        destination: trip.destination,
        ownerId: trip.ownerId,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
      request: err.request,
    });
  }
});

// Giữ endpoint share cũ để Android hiện tại không bị vỡ.
// Endpoint này vẫn add member trực tiếp.
// Sau này nếu muốn production hơn thì đổi share thành request giống join.
app.post("/trips/:id/share", async (req, res) => {
  try {
    const { targetUserId, fromUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({
        message: "targetUserId is required",
      });
    }

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const cleanTarget = normalizeUserId(targetUserId);

    if (cleanTarget === trip.ownerId) {
      return res.status(400).json({
        message: "Target user is already the owner",
      });
    }

    if (!trip.members.includes(cleanTarget)) {
      trip.members.push(cleanTarget);
    }

    trip.updatedBy = fromUserId || "system";
    trip.updatedAt = now();

    await trip.save();

    res.json({
      message: "Shared successfully",
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== TRIP REQUEST APIs ===================== */

// API mới cho Android dùng.
// Trả cả request owner cần duyệt và request user đã gửi.
app.get("/trip-requests", async (req, res) => {
  try {
    const userId = normalizeUserId(req.query.userId);
    const status = req.query.status;

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const ownerQuery = {
      toUserId: userId,
    };

    const myQuery = {
      fromUserId: userId,
    };

    if (status) {
      ownerQuery.status = status;
      myQuery.status = status;
    }

    const ownerRequestsRaw = await TripShareRequest.find(ownerQuery).sort({
      createdAt: -1,
    });

    const myRequestsRaw = await TripShareRequest.find(myQuery).sort({
      createdAt: -1,
    });

    const allTripIds = uniqueStrings([
      ...ownerRequestsRaw.map((r) => r.tripId),
      ...myRequestsRaw.map((r) => r.tripId),
    ]);

    const trips = await Trip.find({
      _id: { $in: allTripIds },
    });

    const tripMap = {};
    trips.forEach((trip) => {
      tripMap[String(trip._id)] = trip;
    });

    const ownerRequests = ownerRequestsRaw.map((request) =>
      buildTripRequestDTO(request, tripMap[request.tripId])
    );

    const myRequests = myRequestsRaw.map((request) =>
      buildTripRequestDTO(request, tripMap[request.tripId])
    );

    res.json({
      ownerRequests,
      myRequests,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/trip-requests/:requestId/accept", async (req, res) => {
  try {
    const { ownerId } = req.body;

    if (!ownerId) {
      return res.status(400).json({
        message: "ownerId is required",
      });
    }

    const request = await TripShareRequest.findById(req.params.requestId);

    if (!request) {
      return res.status(404).json({
        message: "Trip request not found",
      });
    }

    if (request.toUserId !== ownerId) {
      return res.status(403).json({
        message: "Only owner can accept this request",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        message: `Request is already ${request.status}`,
      });
    }

    const trip = await Trip.findById(request.tripId);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    if (trip.ownerId !== ownerId) {
      return res.status(403).json({
        message: "Only trip owner can accept this request",
      });
    }

    if (request.fromUserId !== trip.ownerId && !trip.members.includes(request.fromUserId)) {
      trip.members.push(request.fromUserId);
    }

    trip.updatedBy = ownerId;
    trip.updatedAt = now();

    request.status = "accepted";
    request.updatedAt = now();

    await trip.save();
    await request.save();

    res.json({
      message: "Join request accepted",
      request,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/trip-requests/:requestId/reject", async (req, res) => {
  try {
    const { ownerId } = req.body;

    if (!ownerId) {
      return res.status(400).json({
        message: "ownerId is required",
      });
    }

    const request = await TripShareRequest.findById(req.params.requestId);

    if (!request) {
      return res.status(404).json({
        message: "Trip request not found",
      });
    }

    if (request.toUserId !== ownerId) {
      return res.status(403).json({
        message: "Only owner can reject this request",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        message: `Request is already ${request.status}`,
      });
    }

    request.status = "rejected";
    request.updatedAt = now();

    await request.save();

    res.json({
      message: "Join request rejected",
      request,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== LEGACY TRIP SHARE REQUEST APIs ===================== */

// Giữ lại endpoint cũ để không làm vỡ code cũ.
// Có thể dùng cho direct share request nếu cần.
app.post("/trip-share-request", async (req, res) => {
  try {
    const { tripId, fromUserId, toUserId, message = "" } = req.body;

    if (!tripId || !fromUserId || !toUserId) {
      return res.status(400).json({
        message: "tripId, fromUserId and toUserId are required",
      });
    }

    const trip = await Trip.findById(tripId);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const existing = await TripShareRequest.findOne({
      tripId,
      fromUserId,
      toUserId,
      type: "share",
      status: "pending",
    });

    if (existing) {
      return res.status(409).json({
        message: "Share request already pending",
        request: existing,
      });
    }

    const request = new TripShareRequest({
      tripId,
      fromUserId,
      toUserId,
      type: "share",
      inviteCode: trip.inviteCode || "",
      message,
      status: "pending",
      createdAt: now(),
      updatedAt: now(),
    });

    await request.save();

    res.status(201).json({
      message: "Trip share request sent",
      request,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/trip-share-request", async (req, res) => {
  try {
    const userId = normalizeUserId(req.query.userId);
    const status = req.query.status || "pending";

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const requests = await TripShareRequest.find({
      toUserId: userId,
      status,
    }).sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/trip-share-request/accept", async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({
        message: "requestId is required",
      });
    }

    const request = await TripShareRequest.findById(requestId);

    if (!request) {
      return res.status(404).json({
        message: "Trip share request not found",
      });
    }

    const trip = await Trip.findById(request.tripId);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    if (request.toUserId !== trip.ownerId && !trip.members.includes(request.toUserId)) {
      trip.members.push(request.toUserId);
    }

    trip.updatedBy = request.toUserId;
    trip.updatedAt = now();

    request.status = "accepted";
    request.updatedAt = now();

    await trip.save();
    await request.save();

    res.json({
      message: "Trip share request accepted",
      request,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/trip-share-request/reject", async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({
        message: "requestId is required",
      });
    }

    const request = await TripShareRequest.findByIdAndUpdate(
      requestId,
      {
        status: "rejected",
        updatedAt: now(),
      },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({
        message: "Trip share request not found",
      });
    }

    res.json({
      message: "Trip share request rejected",
      request,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== COLLABORATIVE CHECKLIST APIs ===================== */

app.post("/trips/:id/checklist", async (req, res) => {
  try {
    const {
      text,
      title,
      content = "",
      category = "General",
      assignedTo = "",
      userId = "",
      sourceType = "manual",
      sourceName = "",
      reminder,
    } = req.body;

    if (!text && !title) {
      return res.status(400).json({
        message: "text or title is required",
      });
    }

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const finalCategory = ensureCategoryExists(trip, category);
    const tripUsers = getTripUsers(trip);
    const cleanAssignedTo = normalizeUserId(assignedTo);

    if (cleanAssignedTo && !tripUsers.includes(cleanAssignedTo)) {
      return res.status(400).json({
        message: "assignedTo must be a trip member",
        allowedMembers: tripUsers,
      });
    }

    const item = buildChecklistItem({
      text,
      title,
      content,
      category: finalCategory,
      assignedTo: cleanAssignedTo,
      userId,
      sourceType,
      sourceName,
    });

    trip.checklist.push(item);

    const createdItem = trip.checklist[trip.checklist.length - 1];

    if (
      reminder &&
      reminder.enabled &&
      reminder.title &&
      reminder.latitude !== undefined &&
      reminder.longitude !== undefined
    ) {
      trip.locationReminders.push({
        title: reminder.title,
        message: reminder.message || createdItem.text,
        checklistItemId: String(createdItem._id),
        locationName: reminder.locationName || "",
        latitude: reminder.latitude,
        longitude: reminder.longitude,
        radiusMeters: reminder.radiusMeters || 200,
        enabled: true,
        triggered: false,
        createdBy: userId,
        createdAt: now(),
        updatedAt: now(),
      });
    }

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.status(201).json(trip);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
});

app.patch("/trips/:id/checklist/:itemId", async (req, res) => {
  try {
    const {
      title,
      text,
      content,
      category,
      done,
      assignedTo,
      userId = "",
      reminderId,
    } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const item = trip.checklist.id(req.params.itemId);

    if (!item) {
      return res.status(404).json({
        message: "Checklist item not found",
      });
    }

    if (title !== undefined) item.title = normalizeText(title);
    if (text !== undefined) item.text = normalizeText(text);
    if (content !== undefined) item.content = String(content || "");
    if (category !== undefined) item.category = ensureCategoryExists(trip, category);
    if (typeof done === "boolean") item.done = done;

    if (assignedTo !== undefined) {
      const cleanAssignedTo = normalizeUserId(assignedTo);
      const tripUsers = getTripUsers(trip);

      if (cleanAssignedTo && !tripUsers.includes(cleanAssignedTo)) {
        return res.status(400).json({
          message: "assignedTo must be a trip member",
          allowedMembers: tripUsers,
        });
      }

      item.assignedTo = cleanAssignedTo;
    }

    if (reminderId !== undefined) item.reminderId = normalizeText(reminderId);

    item.updatedBy = userId;
    item.updatedAt = now();

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json(trip);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
});

app.delete("/trips/:id/checklist/:itemId", async (req, res) => {
  try {
    const { userId = "" } = req.body || {};

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const item = trip.checklist.id(req.params.itemId);

    if (!item) {
      return res.status(404).json({
        message: "Checklist item not found",
      });
    }

    const linkedPlanCount = (trip.planItems || []).filter(
      (plan) => plan.sourceChecklistId === String(item._id)
    ).length;

    item.deleteOne();

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json({
      message:
        linkedPlanCount > 0
          ? "Checklist item deleted. Linked plan items remain."
          : "Checklist item deleted.",
      linkedPlanCount,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== ADD PLACE / FOOD TO CHECKLIST ===================== */

app.post("/trips/:id/places/:placeName/add-to-checklist", async (req, res) => {
  try {
    const { userId = "", assignedTo = "", category = "General" } = req.body;
    const placeName = normalizeText(req.params.placeName);

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const place = (trip.places || []).find((p) => p.name === placeName);

    if (!place) {
      return res.status(404).json({
        message: "Place not found",
      });
    }

    const finalCategory = ensureCategoryExists(trip, category);

    trip.checklist.push(
      buildChecklistItem({
        text: `Visit ${place.name}`,
        title: `Visit ${place.name}`,
        content: place.reason || "",
        category: finalCategory,
        assignedTo,
        userId,
        sourceType: "place",
        sourceName: place.name,
      })
    );

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.status(201).json(trip);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
});

app.post("/trips/:id/foods/:foodName/add-to-checklist", async (req, res) => {
  try {
    const { userId = "", assignedTo = "", category = "Food" } = req.body;
    const foodName = normalizeText(req.params.foodName);

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const food = (trip.foods || []).find((f) => f.name === foodName);

    if (!food) {
      return res.status(404).json({
        message: "Food not found",
      });
    }

    const finalCategory = ensureCategoryExists(trip, category);

    trip.checklist.push(
      buildChecklistItem({
        text: `Try ${food.name}`,
        title: `Try ${food.name}`,
        content: food.reason || "",
        category: finalCategory,
        assignedTo,
        userId,
        sourceType: "food",
        sourceName: food.name,
      })
    );

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.status(201).json(trip);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
    });
  }
});

/* ===================== PLAN MAKER APIs ===================== */

app.post("/trips/:id/plan-items", async (req, res) => {
  try {
    const {
      title,
      note = "",
      type = "custom",
      startTime,
      endTime = "",
      locationName = "",
      latitude,
      longitude,
      assignedTo = "",
      sourceChecklistId = "",
      sourceName = "",
      userId = "",
    } = req.body;

    if (!title || !startTime) {
      return res.status(400).json({
        message: "title and startTime are required",
      });
    }

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const cleanAssignedTo = normalizeUserId(assignedTo);
    const tripUsers = getTripUsers(trip);

    if (cleanAssignedTo && !tripUsers.includes(cleanAssignedTo)) {
      return res.status(400).json({
        message: "assignedTo must be a trip member",
        allowedMembers: tripUsers,
      });
    }

    trip.planItems.push({
      title: normalizeText(title),
      note: normalizeText(note),
      type: PLAN_TYPES.includes(type) ? type : "custom",
      startTime: normalizeText(startTime),
      endTime: normalizeText(endTime),
      locationName: normalizeText(locationName),
      latitude,
      longitude,
      assignedTo: cleanAssignedTo,
      sourceChecklistId: normalizeText(sourceChecklistId),
      sourceName: normalizeText(sourceName),
      done: false,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now(),
      updatedAt: now(),
    });

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.status(201).json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.patch("/trips/:id/plan-items/:planItemId", async (req, res) => {
  try {
    const {
      title,
      note,
      type,
      startTime,
      endTime,
      locationName,
      latitude,
      longitude,
      assignedTo,
      done,
      userId = "",
    } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const planItem = trip.planItems.id(req.params.planItemId);

    if (!planItem) {
      return res.status(404).json({
        message: "Plan item not found",
      });
    }

    if (title !== undefined) planItem.title = normalizeText(title);
    if (note !== undefined) planItem.note = normalizeText(note);
    if (type !== undefined) planItem.type = PLAN_TYPES.includes(type) ? type : "custom";
    if (startTime !== undefined) planItem.startTime = normalizeText(startTime);
    if (endTime !== undefined) planItem.endTime = normalizeText(endTime);
    if (locationName !== undefined) planItem.locationName = normalizeText(locationName);
    if (latitude !== undefined) planItem.latitude = latitude;
    if (longitude !== undefined) planItem.longitude = longitude;

    if (assignedTo !== undefined) {
      const cleanAssignedTo = normalizeUserId(assignedTo);
      const tripUsers = getTripUsers(trip);

      if (cleanAssignedTo && !tripUsers.includes(cleanAssignedTo)) {
        return res.status(400).json({
          message: "assignedTo must be a trip member",
          allowedMembers: tripUsers,
        });
      }

      planItem.assignedTo = cleanAssignedTo;
    }

    if (typeof done === "boolean") planItem.done = done;

    planItem.updatedBy = userId;
    planItem.updatedAt = now();

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.delete("/trips/:id/plan-items/:planItemId", async (req, res) => {
  try {
    const { userId = "" } = req.body || {};

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const planItem = trip.planItems.id(req.params.planItemId);

    if (!planItem) {
      return res.status(404).json({
        message: "Plan item not found",
      });
    }

    planItem.deleteOne();

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json({
      message: "Plan item deleted",
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/trips/:id/generate-plan", async (req, res) => {
  try {
    const { userId = "", overwrite = false, startDate = "" } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    if ((trip.planItems || []).length > 0 && !overwrite) {
      return res.status(409).json({
        message: "Plan already exists. Send overwrite=true to replace it.",
        planItems: trip.planItems,
      });
    }

    const places = trip.places || [];
    const foods = trip.foods || [];
    const checklist = trip.checklist || [];

    const hotelTask = checklist.find((item) => item.category === "Hotel");
    const transportTask = checklist.find((item) => item.category === "Transport");

    const generated = [];

    generated.push({
      title: transportTask ? transportTask.text : "Start trip",
      note: "Chuẩn bị di chuyển và kiểm tra hành lý.",
      type: "transport",
      startTime: "08:00",
      endTime: "09:00",
      locationName: "",
      assignedTo: "",
      sourceChecklistId: transportTask ? String(transportTask._id) : "",
      sourceName: transportTask ? transportTask.text : "",
      createdBy: userId,
      updatedBy: userId,
      createdAt: now(),
      updatedAt: now(),
    });

    if (hotelTask) {
      generated.push({
        title: hotelTask.text,
        note: "Check-in hoặc xác nhận nơi ở.",
        type: "hotel",
        startTime: "09:00",
        endTime: "10:00",
        locationName: "",
        assignedTo: hotelTask.assignedTo || "",
        sourceChecklistId: String(hotelTask._id),
        sourceName: hotelTask.text,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now(),
        updatedAt: now(),
      });
    }

    if (places[0]) {
      generated.push({
        title: `Visit ${places[0].name}`,
        note: places[0].reason || "",
        type: "place",
        startTime: "10:00",
        endTime: "12:00",
        locationName: places[0].name,
        latitude: places[0].latitude,
        longitude: places[0].longitude,
        assignedTo: "",
        sourceName: places[0].name,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now(),
        updatedAt: now(),
      });
    }

    if (foods[0]) {
      generated.push({
        title: `Try ${foods[0].name}`,
        note: foods[0].reason || "",
        type: "food",
        startTime: "12:00",
        endTime: "13:30",
        locationName: foods[0].name,
        assignedTo: "",
        sourceName: foods[0].name,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now(),
        updatedAt: now(),
      });
    }

    generated.push({
      title: "Rest time",
      note: "Nghỉ ngơi trước khi đi tiếp.",
      type: "rest",
      startTime: "14:00",
      endTime: "15:30",
      locationName: "",
      assignedTo: "",
      createdBy: userId,
      updatedBy: userId,
      createdAt: now(),
      updatedAt: now(),
    });

    if (places[1]) {
      generated.push({
        title: `Visit ${places[1].name}`,
        note: places[1].reason || "",
        type: "place",
        startTime: "16:00",
        endTime: "18:00",
        locationName: places[1].name,
        latitude: places[1].latitude,
        longitude: places[1].longitude,
        assignedTo: "",
        sourceName: places[1].name,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now(),
        updatedAt: now(),
      });
    }

    if (foods[1]) {
      generated.push({
        title: `Try ${foods[1].name}`,
        note: foods[1].reason || "",
        type: "food",
        startTime: "18:30",
        endTime: "20:00",
        locationName: foods[1].name,
        assignedTo: "",
        sourceName: foods[1].name,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now(),
        updatedAt: now(),
      });
    }

    trip.planItems = generated;
    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json({
      message: "Plan generated from notes",
      trip,
      planItems: trip.planItems,
      startDate,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ============================================================
   LOCATION REMINDER APIs
   ============================================================ */

app.patch("/trips/:id/location-reminder", async (req, res) => {
  try {
    const {
      reminderTitle,
      latitude,
      longitude,
      locationName,
      userId = "",
    } = req.body;

    const trip = await Trip.findByIdAndUpdate(
      req.params.id,
      {
        reminderTitle,
        latitude,
        longitude,
        locationName,
        updatedBy: userId,
        updatedAt: now(),
      },
      { new: true }
    );

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json(trip);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/trips/:id/location-reminders", async (req, res) => {
  try {
    const {
      title,
      message = "",
      checklistItemId = "",
      locationName = "",
      latitude,
      longitude,
      radiusMeters = 200,
      userId = "",
    } = req.body;

    if (!title || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        message: "title, latitude and longitude are required",
      });
    }

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    trip.locationReminders.push({
      title,
      message,
      checklistItemId,
      locationName,
      latitude,
      longitude,
      radiusMeters,
      enabled: true,
      triggered: false,
      createdBy: userId,
      createdAt: now(),
      updatedAt: now(),
    });

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    const createdReminder =
      trip.locationReminders[trip.locationReminders.length - 1];

    if (checklistItemId) {
      const item = trip.checklist.id(checklistItemId);
      if (item) {
        item.reminderId = String(createdReminder._id);
        item.updatedBy = userId;
        item.updatedAt = now();
        await trip.save();
      }
    }

    res.status(201).json({
      message: "Location reminder created",
      reminder: createdReminder,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/trips/:id/location-reminders", async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    res.json(trip.locationReminders || []);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/users/:userId/location-reminders", async (req, res) => {
  try {
    const userId = req.params.userId;

    const trips = await Trip.find({
      $or: [{ ownerId: userId }, { members: userId }],
    }).sort({ updatedAt: -1 });

    const reminders = [];

    trips.forEach((trip) => {
      (trip.locationReminders || []).forEach((reminder) => {
        if (reminder.enabled && !reminder.triggered) {
          reminders.push({
            tripId: trip._id,
            tripTitle: trip.title,
            destination: trip.destination,
            reminder,
          });
        }
      });
    });

    res.json(reminders);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.patch("/trips/:id/location-reminders/:reminderId", async (req, res) => {
  try {
    const {
      title,
      message,
      checklistItemId,
      locationName,
      latitude,
      longitude,
      radiusMeters,
      enabled,
      userId = "",
    } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const reminder = trip.locationReminders.id(req.params.reminderId);

    if (!reminder) {
      return res.status(404).json({
        message: "Location reminder not found",
      });
    }

    if (title !== undefined) reminder.title = title;
    if (message !== undefined) reminder.message = message;
    if (checklistItemId !== undefined) reminder.checklistItemId = checklistItemId;
    if (locationName !== undefined) reminder.locationName = locationName;
    if (latitude !== undefined) reminder.latitude = latitude;
    if (longitude !== undefined) reminder.longitude = longitude;
    if (radiusMeters !== undefined) reminder.radiusMeters = radiusMeters;
    if (typeof enabled === "boolean") reminder.enabled = enabled;

    reminder.updatedAt = now();

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json({
      message: "Location reminder updated",
      reminder,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.patch("/trips/:id/location-reminders/:reminderId/trigger", async (req, res) => {
  try {
    const { userId = "" } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const reminder = trip.locationReminders.id(req.params.reminderId);

    if (!reminder) {
      return res.status(404).json({
        message: "Location reminder not found",
      });
    }

    reminder.triggered = true;
    reminder.triggeredBy = userId;
    reminder.triggeredAt = now();
    reminder.updatedAt = now();

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json({
      message: "Location reminder triggered",
      reminder,
      trip,

      // Android dùng phần này để hỏi user review ngay sau khi arrived
      reviewPrompt: {
        shouldAskReview: true,
        placeName: reminder.locationName || reminder.title,
        destination: trip.destination,
        source: "location_reminder",
        reminderId: String(reminder._id),
        checklistItemId: reminder.checklistItemId || "",
      },
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.patch("/trips/:id/location-reminders/:reminderId/reset", async (req, res) => {
  try {
    const { userId = "" } = req.body;

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const reminder = trip.locationReminders.id(req.params.reminderId);

    if (!reminder) {
      return res.status(404).json({
        message: "Location reminder not found",
      });
    }

    reminder.triggered = false;
    reminder.triggeredBy = "";
    reminder.triggeredAt = undefined;
    reminder.enabled = true;
    reminder.updatedAt = now();

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json({
      message: "Location reminder reset",
      reminder,
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.delete("/trips/:id/location-reminders/:reminderId", async (req, res) => {
  try {
    const { userId = "" } = req.body || {};

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const reminder = trip.locationReminders.id(req.params.reminderId);

    if (!reminder) {
      return res.status(404).json({
        message: "Location reminder not found",
      });
    }

    const checklistItemId = reminder.checklistItemId;
    reminder.deleteOne();

    if (checklistItemId) {
      const item = trip.checklist.id(checklistItemId);
      if (item) {
        item.reminderId = "";
        item.updatedBy = userId;
        item.updatedAt = now();
      }
    }

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.json({
      message: "Location reminder deleted",
      trip,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== RATINGS / DATA COLLECTION APIs ===================== */

app.post("/trips/:id/ratings", async (req, res) => {
  try {
    const {
      placeName,
      userId,
      score,
      comment = "",
      imageUrls = [],
      source = "manual",
      reminderId = "",
      checklistItemId = "",
      planItemId = "",
    } = req.body;

    if (!placeName || !userId || !score) {
      return res.status(400).json({
        message: "placeName, userId and score are required",
      });
    }

    const numericScore = Number(score);

    if (numericScore < 1 || numericScore > 5) {
      return res.status(400).json({
        message: "score must be between 1 and 5",
      });
    }

    const trip = await Trip.findById(req.params.id);

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found",
      });
    }

    const cleanSource = ["location_reminder", "plan_done", "manual"].includes(source)
      ? source
      : "manual";

    let finalChecklistItemId = normalizeText(checklistItemId);
    let finalPlanItemId = normalizeText(planItemId);
    let finalReminderId = normalizeText(reminderId);

    // Nếu review từ location reminder thì bắt buộc reminder phải tồn tại và đã triggered.
    // Như vậy data review sạch hơn, không phải review khơi khơi.
    if (cleanSource === "location_reminder") {
      if (!finalReminderId) {
        return res.status(400).json({
          message: "reminderId is required for location_reminder rating",
        });
      }

      const reminder = trip.locationReminders.id(finalReminderId);

      if (!reminder) {
        return res.status(404).json({
          message: "Location reminder not found",
        });
      }

      if (!reminder.triggered) {
        return res.status(400).json({
          message: "You can only review after arriving at this location",
        });
      }

      finalChecklistItemId = finalChecklistItemId || reminder.checklistItemId || "";
    }

    // Nếu sau này Plan Maker gọi source=plan_done thì nên check plan item đã done.
    if (cleanSource === "plan_done") {
      if (!finalPlanItemId) {
        return res.status(400).json({
          message: "planItemId is required for plan_done rating",
        });
      }

      const planItem = trip.planItems.id(finalPlanItemId);

      if (!planItem) {
        return res.status(404).json({
          message: "Plan item not found",
        });
      }

      if (!planItem.done) {
        return res.status(400).json({
          message: "You can only review after completing this plan item",
        });
      }
    }

    // Chặn user review trùng cùng 1 reminder / plan item để dataset không bị spam.
    const alreadyReviewed = (trip.ratings || []).some((rating) => {
      const sameUser = rating.userId === userId;

      if (cleanSource === "location_reminder") {
        return sameUser && rating.reminderId === finalReminderId;
      }

      if (cleanSource === "plan_done") {
        return sameUser && rating.planItemId === finalPlanItemId;
      }

      return false;
    });

    if (alreadyReviewed) {
      return res.status(409).json({
        message: "You already reviewed this item",
      });
    }

    trip.ratings.push({
      placeName: normalizeText(placeName),
      destination: trip.destination,
      userId: normalizeUserId(userId),
      score: numericScore,
      comment: normalizeText(comment),
      imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      source: cleanSource,
      reminderId: finalReminderId,
      checklistItemId: finalChecklistItemId,
      planItemId: finalPlanItemId,
      tripStatusAtReview: trip.status || "",
      createdAt: now(),
    });

    trip.updatedBy = userId;
    trip.updatedAt = now();

    await trip.save();

    res.status(201).json({
      message: "Rating submitted",
      trip,
      rating: trip.ratings[trip.ratings.length - 1],
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});


app.get("/ratings/summary", async (req, res) => {
  try {
    const placeName = req.query.placeName;

    const pipeline = [{ $unwind: "$ratings" }];

    if (placeName) {
      pipeline.push({
        $match: {
          "ratings.placeName": placeName,
        },
      });
    }

    pipeline.push(
      {
        $group: {
          _id: "$ratings.placeName",
          averageScore: { $avg: "$ratings.score" },
          totalReviews: { $sum: 1 },
          comments: {
            $push: {
              userId: "$ratings.userId",
              comment: "$ratings.comment",
              score: "$ratings.score",
              source: "$ratings.source",
              destination: "$ratings.destination",
              reminderId: "$ratings.reminderId",
              checklistItemId: "$ratings.checklistItemId",
              planItemId: "$ratings.planItemId",
              tripStatusAtReview: "$ratings.tripStatusAtReview",
              createdAt: "$ratings.createdAt",
            },
          },
        },
      },
      {
        $sort: {
          averageScore: -1,
          totalReviews: -1,
        },
      }
    );

    const result = await Trip.aggregate(pipeline);

    res.json(result);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/reviews/place", async (req, res) => {
  try {
    const placeName = normalizeText(req.query.placeName);

    if (!placeName) {
      return res.status(400).json({
        message: "placeName is required",
      });
    }

    // Aggregate all ratings matching placeName across all trips
    const pipeline = [
      { $unwind: "$ratings" },
      { $match: { "ratings.placeName": placeName } },
      {
        $group: {
          _id: "$ratings.placeName",
          averageScore: { $avg: "$ratings.score" },
          totalReviews: { $sum: 1 },
          rawReviews: {
            $push: {
              userId: "$ratings.userId",
              score: "$ratings.score",
              comment: "$ratings.comment",
              source: "$ratings.source",
              destination: "$ratings.destination",
              tripStatusAtReview: "$ratings.tripStatusAtReview",
              imageUrls: "$ratings.imageUrls",
              createdAt: "$ratings.createdAt",
            },
          },
        },
      },
    ];

    const aggResult = await Trip.aggregate(pipeline);
    const match = aggResult[0];

    if (!match) {
      return res.json({
        placeName,
        averageScore: 0,
        totalReviews: 0,
        reviews: [],
      });
    }

    // Join user info
    const userIds = [...new Set(match.rawReviews.map((r) => r.userId))];
    const users = await User.find({ userId: { $in: userIds } })
      .select("userId displayName avatarColor")
      .lean();

    const userMap = {};
    for (const u of users) {
      userMap[u.userId] = u;
    }

    const reviews = match.rawReviews
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((r) => {
        const u = userMap[r.userId] || {};
        return {
          userId: r.userId,
          displayName: u.displayName || r.userId,
          avatarColor: u.avatarColor || "#1E88E5",
          score: r.score,
          comment: r.comment,
          source: r.source,
          destination: r.destination,
          tripStatusAtReview: r.tripStatusAtReview,
          imageUrls: r.imageUrls || [],
          createdAt: r.createdAt,
        };
      });

    res.json({
      placeName,
      averageScore: parseFloat(match.averageScore.toFixed(1)),
      totalReviews: match.totalReviews,
      reviews,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============================================================
   LEGACY NOTE APP APIs
   ============================================================ */

const NoteSchema = new mongoose.Schema({
  title: String,
  content: String,

  ownerId: String,
  sharedWith: [String],

  updatedBy: String,
  updatedAt: Number,

  latitude: Number,
  longitude: Number,
  locationName: String,
});

const Note = mongoose.model("Note", NoteSchema);

const ShareRequestSchema = new mongoose.Schema({
  noteId: String,
  fromUserId: String,
  toUserId: String,
  status: { type: String, default: "pending" },
  createdAt: { type: Number, default: Date.now },
});

const ShareRequest = mongoose.model("ShareRequest", ShareRequestSchema);

app.get("/notes", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const notes = await Note.find({
      $or: [{ ownerId: userId }, { sharedWith: userId }],
    }).sort({ updatedAt: -1 });

    res.json(notes);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/notes", async (req, res) => {
  try {
    const note = new Note({
      ...req.body,
      updatedAt: now(),
    });

    await note.save();

    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.put("/notes/:id", async (req, res) => {
  try {
    const note = await Note.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        updatedAt: now(),
      },
      { new: true }
    );

    if (!note) {
      return res.status(404).json({
        message: "Note not found",
      });
    }

    res.json(note);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.delete("/notes/:id", async (req, res) => {
  try {
    const deleted = await Note.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        message: "Note not found",
      });
    }

    res.json({
      message: "Note deleted",
      id: req.params.id,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/share-request", async (req, res) => {
  try {
    const { noteId, fromUserId, toUserId } = req.body;

    if (!noteId || !fromUserId || !toUserId) {
      return res.status(400).json({
        message: "noteId, fromUserId and toUserId are required",
      });
    }

    const request = new ShareRequest({
      noteId,
      fromUserId,
      toUserId,
      status: "pending",
      createdAt: now(),
    });

    await request.save();

    res.json({
      message: "Request sent",
      request,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.get("/share-request", async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const requests = await ShareRequest.find({
      toUserId: userId,
      status: "pending",
    }).sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/share-request/accept", async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({
        message: "requestId is required",
      });
    }

    const request = await ShareRequest.findById(requestId);

    if (!request) {
      return res.status(404).json({
        message: "Share request not found",
      });
    }

    await Note.findByIdAndUpdate(request.noteId, {
      $addToSet: { sharedWith: request.toUserId },
      updatedAt: now(),
      updatedBy: request.toUserId,
    });

    request.status = "accepted";
    await request.save();

    res.json({
      message: "Accepted",
      request,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

app.post("/share-request/reject", async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({
        message: "requestId is required",
      });
    }

    const request = await ShareRequest.findByIdAndUpdate(
      requestId,
      {
        status: "rejected",
      },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({
        message: "Share request not found",
      });
    }

    res.json({
      message: "Rejected",
      request,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

/* ===================== START SERVER ===================== */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TripMate backend running on http://0.0.0.0:${PORT}`);
});