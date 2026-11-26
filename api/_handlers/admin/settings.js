const { json, method } = require("../_lib/auth");
const { requireAdmin } = require("../_lib/admin");

const COLLECTION = process.env.PLATFORM_SETTINGS_COLLECTION || "platform_settings";
const IMAGE_LIMIT = 900000;

const DEFAULT_SETTINGS = {
  organization: { name: "منصة علي عليان الدولية" },
  branding: {
    logoData: "", faviconData: "", bannerData: "",
    primaryColor: "#38bdf8", secondaryColor: "#0e7490", accentColor: "#f59e0b"
  },
  contact: {
    email: "alimohammed20204@gmail.com",
    phone: "+201126529544",
    extraPhone: "+966547803289",
    whatsapp: "01126529544",
    telegram: "https://t.me/alielian",
    messenger: "https://m.me/ali.alyan.92",
    facebook: "https://www.facebook.com/ali.alyan.92",
    twitter: "",
    instagram: "https://www.instagram.com/ali23121982/?hl=ar",
    youtube: "",
    tiktok: ""
  },
  currency: {
    defaultCurrency: "EGP",
    multiCurrency: true,
    enabledCurrencies: ["EGP", "USD", "SAR"],
    rates: { USD: 0, SAR: 0 }
  },
  registration: {
    deviceLimit: false,
    governorateRequired: false,
    cityRequired: false,
    parentPhoneRequired: false,
    schoolYearRequired: true,
    gradeCategoryRequired: true
  },
  seo: {
    metaTitle: "منصة علي عليان الدولية | اللغة العربية | البكالوريا و IGCSE و أمريكان دبلومة و مناهج النيل",
    keywords: "تعليم اللغة العربية، مناهج النيل، علي محمد عليان، شيخ النحو، دورات نحو وبلاغة، IGCSE Arabic 7180",
    metaDescription: "منصة تعليمية رائدة متخصصة في المناهج الدولية International Curricula لتبسيط النحو، البلاغة، والعروض. نقدم دورات متكاملة وامتحانات تجريبية لطلاب المدارس الدولية (IGCSE 7180) ومناهج النيل.",
    googleAnalyticsId: "G-VHX3WHFXF7",
    googleTagManagerId: "GTM-KBMZCT2G",
    googleAdsId: ""
  },
  sections: { courses: true, liveSessions: true, library: true, blog: true, authButtons: true },
  homepage: {
    sections: [
      { id: "stages", name: "المراحل الدراسية / المسارات", visible: true },
      { id: "featuredCourses", name: "الكورسات المميزة", visible: true },
      { id: "articles", name: "المقالات", visible: false },
      { id: "storeProducts", name: "منتجات المتجر", visible: false },
      { id: "custom", name: "القسم المخصص", visible: true },
      { id: "features", name: "مميزاتنا", visible: true },
      { id: "testimonials", name: "آراء العملاء", visible: false },
      { id: "training", name: "الدورات التدريبية", visible: false }
    ],
    primaryButtonText: "", primaryButtonUrl: "",
    secondaryButtonText: "", secondaryButtonUrl: ""
  },
  language: { defaultLanguage: "ar", allowSwitch: true, enabledLanguages: ["ar", "en"] },
  welcomeMessages: [],
  payment: { showOnlineMethods: true },
  legal: { privacyText: "", termsText: "" }
};

function mergeDefaults(defaults, saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return structuredClone(defaults);
  const result = { ...defaults };
  for (const [key, value] of Object.entries(defaults)) {
    const stored = saved[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergeDefaults(value, stored);
    } else if (stored !== undefined) {
      result[key] = stored;
    }
  }
  return result;
}

function textValue(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function imageValue(value, label) {
  const image = String(value || "");
  if (!image) return "";
  if (image.length > IMAGE_LIMIT) throw new Error("حجم صورة " + label + " كبير بعد الضغط. اختر صورة أصغر.");
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    throw new Error("صيغة صورة " + label + " غير مدعومة.");
  }
  return image;
}

function urlValue(value, label) {
  const url = textValue(value, 500);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error("أدخل رابطاً صحيحاً في حقل " + label + ".");
  }
}

function colorValue(value, fallback, label) {
  const color = textValue(value, 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("قيمة " + label + " غير صحيحة.");
  return color.toLowerCase();
}

function safeLinkValue(value, label) {
  const link = textValue(value, 500);
  if (!link) return "";
  if (link.startsWith("/") && !link.startsWith("//")) return link;
  return urlValue(link, label);
}

function rateValue(value, label) {
  const rate = Number(value ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1000000000) {
    throw new Error("سعر التحويل الخاص بعملة " + label + " غير صحيح.");
  }
  return rate;
}

function cleanSettings(input, previous) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("بيانات الإعدادات غير صحيحة.");
  }

  const old = mergeDefaults(DEFAULT_SETTINGS, previous);
  const organization = {
    name: textValue(input.organization?.name || old.organization.name, 140) || DEFAULT_SETTINGS.organization.name
  };

  const branding = {
    logoData: imageValue(input.branding?.logoData, "الشعار"),
    faviconData: imageValue(input.branding?.faviconData, "الأيقونة"),
    bannerData: imageValue(input.branding?.bannerData, "البانر"),
    primaryColor: colorValue(input.branding?.primaryColor, old.branding.primaryColor, "اللون الرئيسي"),
    secondaryColor: colorValue(input.branding?.secondaryColor, old.branding.secondaryColor, "اللون الثانوي"),
    accentColor: colorValue(input.branding?.accentColor, old.branding.accentColor, "اللون المميز")
  };

  const email = textValue(input.contact?.email, 254).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("البريد الإلكتروني في معلومات التواصل غير صحيح.");
  }
  const contact = {
    email,
    phone: textValue(input.contact?.phone, 40),
    extraPhone: textValue(input.contact?.extraPhone, 40),
    whatsapp: textValue(input.contact?.whatsapp, 40),
    telegram: urlValue(input.contact?.telegram, "تليجرام"),
    messenger: urlValue(input.contact?.messenger, "ماسنجر"),
    facebook: urlValue(input.contact?.facebook, "فيسبوك"),
    twitter: urlValue(input.contact?.twitter, "تويتر"),
    instagram: urlValue(input.contact?.instagram, "انستجرام"),
    youtube: urlValue(input.contact?.youtube, "يوتيوب"),
    tiktok: urlValue(input.contact?.tiktok, "تيك توك")
  };

  const allowedCurrencies = ["EGP", "USD", "SAR"];
  const defaultCurrency = allowedCurrencies.includes(input.currency?.defaultCurrency)
    ? input.currency.defaultCurrency : "EGP";
  const enabledCurrencies = Array.isArray(input.currency?.enabledCurrencies)
    ? [...new Set(input.currency.enabledCurrencies.filter(value => allowedCurrencies.includes(value)))]
    : [defaultCurrency];
  if (!enabledCurrencies.length) throw new Error("اختر عملة واحدة على الأقل.");
  if (!enabledCurrencies.includes(defaultCurrency)) enabledCurrencies.unshift(defaultCurrency);
  const currency = {
    defaultCurrency,
    multiCurrency: input.currency?.multiCurrency === true,
    enabledCurrencies,
    rates: {
      USD: rateValue(input.currency?.rates?.USD, "USD"),
      SAR: rateValue(input.currency?.rates?.SAR, "SAR")
    }
  };

  const registration = {};
  for (const key of [
    "deviceLimit", "governorateRequired", "cityRequired", "parentPhoneRequired",
    "schoolYearRequired", "gradeCategoryRequired"
  ]) {
    registration[key] = input.registration?.[key] === true;
  }
  if (registration.cityRequired && !registration.governorateRequired) {
    throw new Error("يجب تفعيل طلب المحافظة قبل تفعيل طلب المدينة.");
  }

  const seo = {
    metaTitle: textValue(input.seo?.metaTitle, 180),
    keywords: textValue(input.seo?.keywords, 1000),
    metaDescription: textValue(input.seo?.metaDescription, 500),
    googleAnalyticsId: textValue(input.seo?.googleAnalyticsId, 80),
    googleTagManagerId: textValue(input.seo?.googleTagManagerId, 80),
    googleAdsId: textValue(input.seo?.googleAdsId, 80)
  };

  const sectionInput = input.sections || old.sections;
  const sections = {
    courses: sectionInput.courses === true,
    liveSessions: sectionInput.liveSessions === true,
    library: sectionInput.library === true,
    blog: sectionInput.blog === true,
    authButtons: sectionInput.authButtons === true
  };

  const homepageInput = input.homepage || old.homepage;
  const baseHomeSections = old.homepage.sections;
  const sourceHomeSections = Array.isArray(homepageInput.sections) ? homepageInput.sections : baseHomeSections;
  const seenHomeSections = new Set();
  const homepageSections = [];
  for (const item of sourceHomeSections.slice(0, baseHomeSections.length)) {
    const id = textValue(item?.id, 40);
    const template = baseHomeSections.find(section => section.id === id);
    if (!template || seenHomeSections.has(id)) continue;
    seenHomeSections.add(id);
    homepageSections.push({ id, name: template.name, visible: item.visible === true });
  }
  for (const template of baseHomeSections) {
    if (!seenHomeSections.has(template.id)) homepageSections.push({ ...template });
  }
  const homepage = {
    sections: homepageSections,
    primaryButtonText: textValue(homepageInput.primaryButtonText, 80),
    primaryButtonUrl: safeLinkValue(homepageInput.primaryButtonUrl, "رابط الزر الرئيسي"),
    secondaryButtonText: textValue(homepageInput.secondaryButtonText, 80),
    secondaryButtonUrl: safeLinkValue(homepageInput.secondaryButtonUrl, "رابط الزر الثانوي")
  };

  const languageInput = input.language || old.language;
  const defaultLanguage = ["ar", "en"].includes(languageInput.defaultLanguage) ? languageInput.defaultLanguage : "ar";
  const enabledLanguages = Array.isArray(languageInput.enabledLanguages)
    ? [...new Set(languageInput.enabledLanguages.filter(value => ["ar", "en"].includes(value)))]
    : [...old.language.enabledLanguages];
  if (!enabledLanguages.length) throw new Error("اختر لغة واحدة على الأقل.");
  if (!enabledLanguages.includes(defaultLanguage)) enabledLanguages.unshift(defaultLanguage);
  const language = { defaultLanguage, allowSwitch: languageInput.allowSwitch === true, enabledLanguages };

  const sourceMessages = Array.isArray(input.welcomeMessages) ? input.welcomeMessages : old.welcomeMessages;
  if (sourceMessages.length > 50) throw new Error("يمكن حفظ 50 رسالة ترحيب كحد أقصى.");
  const welcomeIds = new Set();
  const welcomeMessages = sourceMessages.map((message, index) => {
    const id = textValue(message?.id, 80) || String(index + 1);
    if (welcomeIds.has(id)) throw new Error("يوجد تكرار في معرفات رسائل الترحيب.");
    welcomeIds.add(id);
    const title = textValue(message?.title, 120);
    const body = textValue(message?.body, 3000);
    if (!title || !body) throw new Error("كل رسالة ترحيب يجب أن تحتوي على عنوان ونص.");
    return { id, title, body };
  });

  const paymentInput = input.payment || old.payment;
  const payment = { showOnlineMethods: paymentInput.showOnlineMethods === true };
  const legalInput = input.legal || old.legal;
  const legal = {
    privacyText: textValue(legalInput.privacyText, 50000),
    termsText: textValue(legalInput.termsText, 50000)
  };

  return {
    organization, branding, contact, currency, registration, seo,
    sections, homepage, language, welcomeMessages, payment, legal
  };
}

module.exports = async function handler(req, res) {
  if (!["GET", "PUT"].includes(req.method)) {
    res.setHeader("Allow", "GET, PUT");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  }

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });

    const collection = auth.database.collection(COLLECTION);
    const saved = await collection.findOne({ _id: "organization" });

    if (req.method === "GET") {
      return json(res, 200, {
        ok: true,
        settings: mergeDefaults(DEFAULT_SETTINGS, saved?.settings),
        updatedAt: saved?.updatedAt || null,
        siteUrl: process.env.APP_URL || ""
      });
    }

    let settings;
    try {
      settings = cleanSettings(req.body?.settings, saved?.settings);
    } catch (error) {
      return json(res, 400, { ok: false, message: error.message });
    }

    const updatedAt = new Date();
    await collection.updateOne(
      { _id: "organization" },
      { $set: { settings, updatedAt, updatedBy: auth.admin._id } },
      { upsert: true }
    );

    return json(res, 200, {
      ok: true,
      message: "تم حفظ إعدادات المؤسسة في قاعدة البيانات.",
      settings,
      updatedAt
    });
  } catch (error) {
    console.error("admin organization settings failed:", error.message);
    return json(res, 500, {
      ok: false,
      message: "تعذر تحميل أو حفظ إعدادات المؤسسة. تحقق من اتصال قاعدة البيانات."
    });
  }
};
