import React, { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Diva Refeições — sistema de pedidos conectado ao Supabase
// Paleta: vermelho profundo + dourado + creme, inspirada na marca do cliente
// ---------------------------------------------------------------------------

const SUPABASE_URL = "https://hvcbeuajuvvmukookixy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__QA8TrlhA5Rnf3WIb_gAVg_1Y9QuN7s";

// ATENÇÃO DE SEGURANÇA: só a chave PUBLICÁVEL (acima) fica no código do site.
// A chave secreta NUNCA deve entrar aqui — ela fica só na Edge Function (server-side).

// PIN provisório para abrir o painel admin. Isto NÃO é segurança de verdade
// (é só um filtro contra acesso casual) — o próximo passo é trocar isto por
// login real via Supabase Auth.
const ADMIN_PIN = "diva2026";

// PIN separado, só seu, pra liberar o bloco de controle da assinatura
// dentro do próprio painel admin — troque por um PIN só seu.
const DEV_PIN = "0112";

// Número do dono que recebe os pedidos pelo WhatsApp (formato internacional, só dígitos)
const OWNER_WHATSAPP = "5583988425981";

// ---------------------------------------------------------------------------
// Assinatura mensal do sistema (cobrada por VOCÊ, desenvolvedor, à dona da
// marmitaria) — troque pelos SEUS dados antes de publicar.
// ---------------------------------------------------------------------------
const DEV_WHATSAPP = "5583988622980"; // seu número, só dígitos, com DDI 55
const DEV_PIX_KEY = "83988622980";
const DEV_NAME = "Alisson Cavalcanti";
const MONTHLY_PRICE = 80;

function itemLines(item) {
  const rubacao = isRubacaoSize(item.size);
  const qtyPrefix = item.quantity > 1 ? `${item.quantity}× ` : "";
  const lines = [`${qtyPrefix}${sizeDisplayName(item.size)}`];
  if (rubacao) {
    lines.push(`   Macarrão: ${(item.side_names || []).includes("Macarrão") ? "Sim" : "Não"}`);
  } else {
    lines.push(`   Feijão: ${item.feijao_choice || "—"} · Acompanhamentos: ${(item.side_names || []).join(", ") || "—"}`);
  }
  lines.push(`   Saladas: ${(item.salada_names || []).join(", ") || "—"}`);
  lines.push(`   Carnes: ${item.principal_names.join(", ")}`);
  return lines;
}

function buildWhatsappOrderLink(order) {
  const lines = [
    `🍱 *Novo pedido — ${order.id}*`,
    "",
    `*Cliente:* ${order.customerName}`,
    ...(order.phone ? [`*WhatsApp:* ${order.phone}`] : []),
    "",
    `*Itens:*`,
    ...order.items.flatMap((item) => itemLines(item)),
    "",
    `*Bebida:* ${order.drink}`,
    `*Entrega:* ${order.address}`,
    `*Pagamento:* ${order.payment}`,
    ...(order.payment === "Dinheiro" && order.changeAmount != null
      ? [`*Troca com:* ${currency(order.cashAmount)}`, `*Troco:* ${currency(order.changeAmount)}`]
      : []),
    "",
    `*Total: ${currency(order.total)}*`,
  ];
  const text = encodeURIComponent(lines.join("\n"));
  return `https://wa.me/${OWNER_WHATSAPP}?text=${text}`;
}

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Erro Supabase (${res.status}): ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const FONTS_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');`;

const TOKENS = {
  red: "#8C1220",
  redDark: "#5C0C15",
  redSoft: "#B8382F",
  gold: "#CC9A3A",
  goldLight: "#E8C874",
  cream: "#FBF3E4",
  creamDeep: "#F3E6CC",
  ink: "#2A1610",
  inkSoft: "#6B4A3D",
  ok: "#3F7D52",
};

function Emblem({ size = 44, color = TOKENS.gold, ring = TOKENS.gold }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="50" r="47" stroke={ring} strokeWidth="3" />
      <g stroke={color} strokeWidth="3.4" strokeLinecap="round">
        <line x1="38" y1="26" x2="38" y2="50" />
        <line x1="33" y1="26" x2="33" y2="42" />
        <line x1="38" y1="26" x2="38" y2="42" />
        <line x1="43" y1="26" x2="43" y2="42" />
        <path d="M33 42 Q38 50 43 42" />
        <line x1="38" y1="50" x2="60" y2="74" />
        <path d="M64 26 C58 26 55 32 55 40 C55 48 58 52 62 52 L62 74" />
      </g>
    </svg>
  );
}

const SIZE_LABELS = { P: "Pequena", M: "Média", G: "Grande", RP: "Pequena", RM: "Média", RG: "Grande" };
const SIZES = ["P", "M", "G"];
const PAYMENT_METHODS = ["Pix", "Cartão (crédito/débito)", "Dinheiro"];

// ---------------------------------------------------------------------------
// Rubacão — tamanho especial que só acompanha macarrão (sem feijão, sem
// acompanhamentos avulsos). Preço e limite de carnes ficam fixos aqui no
// código; se a cliente quiser editar isso pelo painel admin no futuro, dá
// pra mover para a tabela "settings" no Supabase.
// ---------------------------------------------------------------------------
const RUBACAO_SIZES = ["RP", "RM", "RG"];
const RUBACAO_PRICES = { RP: 16, RM: 22, RG: 28 };
const RUBACAO_PRINCIPAL_LIMITS = { RP: 1, RM: 2, RG: 2 };

function isRubacaoSize(s) {
  return RUBACAO_SIZES.includes(s);
}
function sizeDisplayName(s) {
  if (!s) return "";
  return isRubacaoSize(s) ? `Rubacão ${SIZE_LABELS[s]}` : `Quentinha ${SIZE_LABELS[s]}`;
}

function currency(v) {
  return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function playNotificationSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  } catch (e) {
    // navegador sem suporte a Web Audio — sem som, sem quebrar o app
  }
}

// ---------------------------------------------------------------------------
// Mapeamento Supabase <-> estado local
// ---------------------------------------------------------------------------

function mapSettings(row) {
  return {
    sizePrices: {
      P: Number(row.size_price_p),
      M: Number(row.size_price_m),
      G: row.size_price_g != null ? Number(row.size_price_g) : 28,
    },
    deliveryFee: Number(row.delivery_fee),
    principalLimits: {
      P: row.principal_limit_p,
      M: row.principal_limit_m,
      G: row.principal_limit_g != null ? row.principal_limit_g : 2,
    },
    cardSurcharge: { type: row.card_surcharge_type, value: Number(row.card_surcharge_value) },
    rubacaoEnabled: row.rubacao_enabled !== false,
    accessUntil: row.access_until || null,
    openHour: row.open_hour != null ? Number(row.open_hour) : 9.5,
    closeHour: row.close_hour != null ? Number(row.close_hour) : 14,
    deliveryStartHour: row.delivery_start_hour != null ? Number(row.delivery_start_hour) : 11,
    soldOutDate: row.sold_out_date || null,
  };
}

async function loadMenuFromSupabase() {
  const [principals, acompanhamentos, saladas, feijaoOpcoes, drinks, settingsRows] = await Promise.all([
    sb("principals?select=*&order=name.asc"),
    sb("acompanhamentos?select=*&order=name.asc"),
    sb("saladas?select=*&order=name.asc"),
    sb("feijao_opcoes?select=*&order=name.asc"),
    sb("drinks?select=*&order=name.asc"),
    sb("settings?select=*&id=eq.1"),
  ]);
  const settings = mapSettings(settingsRows[0]);
  return {
    ...settings,
    principals: principals.map((p) => ({ id: p.id, name: p.name, available: p.available, extraPrice: Number(p.extra_price) })),
    acompanhamentos: acompanhamentos.map((s) => ({ id: s.id, name: s.name, available: s.available })),
    saladas: saladas.map((s) => ({ id: s.id, name: s.name, available: s.available })),
    feijaoOpcoes: feijaoOpcoes.map((f) => ({ id: f.id, name: f.name, available: f.available })),
    drinks: drinks.map((d) => ({ id: d.id, name: d.name, price: Number(d.price) })),
  };
}

function mapOrderFromSupabase(o) {
  const items =
    o.items && o.items.length
      ? o.items
      : [
          {
            size: o.size,
            quantity: o.quantity || 1,
            principal_names: o.principal_names || [],
            feijao_choice: o.feijao_choice || null,
            side_names: o.side_names || [],
            salada_names: o.salada_names || [],
          },
        ];
  return {
    id: o.order_number,
    dbId: o.id,
    customerName: o.customer_name,
    phone: o.customer_phone,
    address: o.delivery_address,
    payment: o.payment_method,
    cashAmount: o.cash_amount != null ? Number(o.cash_amount) : null,
    changeAmount: o.change_amount != null ? Number(o.change_amount) : null,
    items,
    drink: o.drink_name || "Sem bebida",
    total: Number(o.total),
    status: o.status,
    createdAt: new Date(o.created_at),
  };
}

// ---------------------------------------------------------------------------
// FLUXO DO CLIENTE
// ---------------------------------------------------------------------------

function StepDots({ step, total }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "4px 0 22px", flexWrap: "wrap" }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === step ? 22 : 8,
            height: 8,
            borderRadius: 999,
            background: i <= step ? TOKENS.gold : "#E4D6BC",
            transition: "all .25s ease",
          }}
        />
      ))}
    </div>
  );
}

const STEP_LABELS = ["Tamanho", "Feijão", "Acompanhamentos", "Saladas", "Carnes", "Itens do pedido", "Bebida", "Entrega", "Pagamento", "Confirmação"];

function CustomerFlow({ menu, onOrderPlaced }) {
  const [step, setStep] = useState(0);
  const [size, setSize] = useState(null);
  const [feijaoChoice, setFeijaoChoice] = useState(null);
  const [selectedAcompanhamentos, setSelectedAcompanhamentos] = useState([]);
  const [selectedPrincipals, setSelectedPrincipals] = useState([]);
  const [selectedSaladas, setSelectedSaladas] = useState([]);
  const [rubacaoMacarrao, setRubacaoMacarrao] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState([]);
  const [drink, setDrink] = useState("none");
  const [form, setForm] = useState({ name: "", phone: "", address: "", payment: "Pix" });
  const [cashAmount, setCashAmount] = useState("");
  const [done, setDone] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const isRubacao = isRubacaoSize(size);

  useEffect(() => {
    if (isRubacao && !menu.rubacaoEnabled) setSize(null);
  }, [menu.rubacaoEnabled, isRubacao]);

  const sizePrice = size ? (isRubacao ? RUBACAO_PRICES[size] : menu.sizePrices[size]) : 0;
  const principalLimit = size ? (isRubacao ? RUBACAO_PRINCIPAL_LIMITS[size] : menu.principalLimits[size]) : 0;
  const selectedPrincipalObjs = menu.principals.filter((p) => selectedPrincipals.includes(p.id));
  const extraPrincipal = size === "P" ? selectedPrincipalObjs.reduce((sum, p) => sum + (p.extraPrice || 0), 0) : 0;
  const feijaoObj = menu.feijaoOpcoes.find((f) => f.id === feijaoChoice);
  const drinkObj = menu.drinks.find((d) => d.id === drink);
  const drinkPrice = drinkObj ? drinkObj.price : 0;

  // Item que está sendo montado agora (ainda não adicionado ao carrinho)
  const currentItemUnitPrice = sizePrice + extraPrincipal;
  const currentItemSubtotal = currentItemUnitPrice * quantity;
  const cartSubtotal = cart.reduce((sum, it) => sum + it.subtotal, 0);

  const cardExtra =
    form.payment === "Cartão (crédito/débito)"
      ? menu.cardSurcharge.type === "percent"
        ? (cartSubtotal + drinkPrice + menu.deliveryFee) * (menu.cardSurcharge.value / 100)
        : menu.cardSurcharge.value
      : 0;

  const total = cartSubtotal + drinkPrice + menu.deliveryFee + cardExtra;

  const cashAmountNum = parseFloat(cashAmount.replace(",", ".")) || 0;
  const troco = form.payment === "Dinheiro" ? cashAmountNum - total : 0;

  const steps = STEP_LABELS;

  function buildCartItem() {
    return {
      size,
      quantity,
      principal_names: selectedPrincipalObjs.map((p) => p.name),
      feijao_choice: isRubacao ? null : feijaoObj ? feijaoObj.name : null,
      side_names: isRubacao ? (rubacaoMacarrao ? ["Macarrão"] : []) : selectedAcompanhamentos.map(acompanhamentoName),
      salada_names: selectedSaladas.map(saladaName),
      unitPrice: currentItemUnitPrice,
      subtotal: currentItemSubtotal,
    };
  }

  function resetItemFields() {
    setSize(null);
    setSelectedPrincipals([]);
    setFeijaoChoice(null);
    setSelectedAcompanhamentos([]);
    setSelectedSaladas([]);
    setRubacaoMacarrao(true);
    setQuantity(1);
  }

  function addItemAndGoto(nextStep) {
    if (size) {
      setCart((c) => [...c, buildCartItem()]);
      resetItemFields();
    }
    setStep(nextStep);
  }

  function removeCartItem(idx) {
    setCart((c) => c.filter((_, i) => i !== idx));
  }

  // Rubacão não passa por Feijão (1) nem Acompanhamentos (2) — vai direto de
  // Tamanho (0) para Carnes (3). Nos demais tamanhos, os passos seguem 1 a 1.
  function nextStepFrom(cur) {
    if (cur === 0 && isRubacao) return 2;
    return cur + 1;
  }
  function prevStepFrom(cur) {
    if (cur === 2 && isRubacao) return 0;
    return cur - 1;
  }

  function togglePrincipal(id) {
    setSelectedPrincipals((cur) => {
      if (cur.includes(id)) return cur.filter((p) => p !== id);
      if (cur.length >= principalLimit) return cur;
      return [...cur, id];
    });
  }

  function toggleAcompanhamento(id) {
    setSelectedAcompanhamentos((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));
  }

  function toggleSalada(id) {
    setSelectedSaladas((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));
  }

  function canAdvance() {
    if (step === 0) return !!size;
    if (step === 1) return !!feijaoChoice;
    if (step === 2) return isRubacao ? true : selectedAcompanhamentos.length > 0;
    if (step === 3) return true;
    if (step === 4) return selectedPrincipals.length > 0;
    if (step === 5) return true;
    if (step === 6) return true;
    if (step === 7) return form.name.trim() && form.address.trim();
    if (step === 8) {
      if (form.payment === "Dinheiro") return cashAmount.trim() !== "" && cashAmountNum >= total;
      return true;
    }
    return true;
  }

  function acompanhamentoName(id) {
    return menu.acompanhamentos.find((s) => s.id === id)?.name;
  }
  function saladaName(id) {
    return menu.saladas.find((s) => s.id === id)?.name;
  }

  async function confirmOrder() {
    setSending(true);
    setError("");
    const orderNumber = "PED-" + Math.floor(1000 + Math.random() * 9000);
    const first = cart[0] || {};
    const body = {
      order_number: orderNumber,
      customer_name: form.name,
      customer_phone: form.phone || null,
      delivery_address: form.address,
      items: cart,
      // Campos abaixo mantidos por compatibilidade (refletem o 1º item do
      // carrinho) — usados pela restrição de tamanho do banco e por telas
      // antigas do admin que ainda não foram atualizadas para múltiplos itens.
      size: first.size,
      quantity: first.quantity,
      principal_names: first.principal_names,
      feijao_choice: first.feijao_choice,
      side_names: first.side_names,
      salada_names: first.salada_names,
      drink_name: drinkObj ? drinkObj.name : null,
      payment_method: form.payment,
      cash_amount: form.payment === "Dinheiro" ? cashAmountNum : null,
      change_amount: form.payment === "Dinheiro" ? troco : null,
      total,
      status: "Novo",
    };
    try {
      const [inserted] = await sb("orders", { method: "POST", body: JSON.stringify(body) });
      const localOrder = mapOrderFromSupabase(inserted);
      onOrderPlaced(localOrder);
      setDone(localOrder);
      // Abre o WhatsApp automaticamente com o pedido já preenchido — a única
      // ação que sobra pro cliente é tocar em "Enviar" dentro do WhatsApp
      // (o próprio WhatsApp não permite que nenhum site envie por ele).
      window.open(buildWhatsappOrderLink(localOrder), "_blank");
    } catch (e) {
      setError("Não consegui enviar seu pedido. Tente novamente em instantes.");
    } finally {
      setSending(false);
    }
  }

  function resetAll() {
    setDone(null);
    setStep(0);
    setSize(null);
    setFeijaoChoice(null);
    setSelectedAcompanhamentos([]);
    setSelectedPrincipals([]);
    setSelectedSaladas([]);
    setRubacaoMacarrao(true);
    setQuantity(1);
    setCart([]);
    setDrink("none");
    setCashAmount("");
    setForm({ name: "", phone: "", address: "", payment: "Pix" });
  }

  if (done) {
    return (
      <div style={card()}>
        <div style={{ textAlign: "center", padding: "8px 4px" }}>
          <Emblem size={56} />
          <h2 style={{ fontFamily: "Fraunces", color: TOKENS.red, margin: "14px 0 4px" }}>
            Pedido confirmado!
          </h2>
          <p style={{ color: TOKENS.inkSoft, marginBottom: 18 }}>
            Nº do pedido <b style={{ color: TOKENS.ink }}>{done.id}</b> — já recebemos seu pedido e já estamos preparando.
          </p>
          <div style={{ ...summaryBox(), textAlign: "left" }}>
            {done.items.map((it, idx) => (
              <div key={idx} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: idx < done.items.length - 1 ? `1px solid ${TOKENS.creamDeep}` : "none" }}>
                <SummaryLine label={it.quantity > 1 ? `${it.quantity}× ${sizeDisplayName(it.size)}` : sizeDisplayName(it.size)} value="" />
                <p style={{ fontSize: 12, color: TOKENS.inkSoft, margin: "2px 0 0" }}>
                  {isRubacaoSize(it.size)
                    ? `Macarrão: ${(it.side_names || []).includes("Macarrão") ? "Sim" : "Não"}`
                    : `Feijão: ${it.feijao_choice || "—"} · ${(it.side_names || []).join(", ") || "Sem acompanhamentos"}`}
                  {(it.salada_names || []).length > 0 ? ` · Saladas: ${it.salada_names.join(", ")}` : ""}
                  {` · Carnes: ${(it.principal_names || []).join(", ")}`}
                </p>
              </div>
            ))}
            <SummaryLine label="Bebida" value={done.drink} />
            <SummaryLine label="Entrega" value={done.address} />
            <SummaryLine label="Pagamento" value={done.payment} />
            {done.payment === "Dinheiro" && done.changeAmount != null && (
              <>
                <SummaryLine label="Troca com" value={currency(done.cashAmount)} />
                <SummaryLine label="Troco" value={currency(done.changeAmount)} />
              </>
            )}
            <div style={{ height: 1, background: TOKENS.creamDeep, margin: "10px 0" }} />
            <SummaryLine label="Total" value={currency(done.total)} bold />
          </div>
          <p style={{ fontSize: 12.5, color: TOKENS.inkSoft, marginTop: 12 }}>
            O WhatsApp deve ter aberto automaticamente com seu pedido pronto — é só tocar em <b>Enviar</b> por lá.
            {done.payment === "Pix" && " Aproveite e mande também o comprovante do Pix."}
          </p>
          <a
            href={buildWhatsappOrderLink(done)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...primaryBtn(), marginTop: 12, display: "block", textDecoration: "none", textAlign: "center" }}
          >
            Não abriu? Toque aqui
          </a>
          <button style={{ ...secondaryBtn(), marginTop: 10, width: "100%" }} onClick={resetAll}>
            Fazer novo pedido
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={card()}>
      <StepDots step={step} total={steps.length - 1} />
      <p style={{ textAlign: "center", fontSize: 12, letterSpacing: 1.5, color: TOKENS.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>
        {steps[step]}
      </p>

      {step === 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSize(s);
                setSelectedPrincipals([]);
              }}
              style={sizeOption(size === s)}
            >
              <span style={{ fontFamily: "Fraunces", fontSize: 22 }}>{s}</span>
              <span style={{ flex: 1, textAlign: "left", marginLeft: 12 }}>
                Quentinha {SIZE_LABELS[s]}
              </span>
              <span style={{ fontWeight: 700 }}>{currency(menu.sizePrices[s])}</span>
            </button>
          ))}

          {menu.rubacaoEnabled && (
            <>
              <p style={{ fontSize: 12, letterSpacing: 1.5, color: TOKENS.gold, fontWeight: 700, textTransform: "uppercase", margin: "10px 0 0" }}>
                Rubacão
              </p>
              {RUBACAO_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setSize(s);
                    setSelectedPrincipals([]);
                  }}
                  style={sizeOption(size === s)}
                >
                  <span style={{ fontFamily: "Fraunces", fontSize: 22 }}>{s.replace("R", "")}</span>
                  <span style={{ flex: 1, textAlign: "left", marginLeft: 12 }}>
                    Rubacão {SIZE_LABELS[s]}
                    <span style={{ display: "block", fontSize: 11.5, color: TOKENS.inkSoft, fontWeight: 400 }}>
                      {RUBACAO_PRINCIPAL_LIMITS[s]} tipo{RUBACAO_PRINCIPAL_LIMITS[s] > 1 ? "s" : ""} de carne · macarrão opcional
                    </span>
                  </span>
                  <span style={{ fontWeight: 700 }}>{currency(RUBACAO_PRICES[s])}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {step === 1 && (
        <div>
          <p style={{ color: TOKENS.inkSoft, fontSize: 13, marginBottom: 12 }}>Escolha 1 tipo de feijão</p>
          <div style={{ display: "grid", gap: 10 }}>
            {menu.feijaoOpcoes.filter((f) => f.available).map((f) => (
              <button key={f.id} onClick={() => setFeijaoChoice(f.id)} style={choiceOption(feijaoChoice === f.id)}>
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          {isRubacao ? (
            <>
              <p style={{ color: TOKENS.inkSoft, fontSize: 13, marginBottom: 12 }}>Deseja macarrão junto com o Rubacão?</p>
              <div style={{ display: "grid", gap: 10 }}>
                <button onClick={() => setRubacaoMacarrao(true)} style={choiceOption(rubacaoMacarrao === true)}>
                  Sim, quero macarrão
                </button>
                <button onClick={() => setRubacaoMacarrao(false)} style={choiceOption(rubacaoMacarrao === false)}>
                  Não, sem macarrão
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ color: TOKENS.inkSoft, fontSize: 13, marginBottom: 12 }}>Escolha quantos acompanhamentos quiser</p>
              <div style={{ display: "grid", gap: 10 }}>
                {menu.acompanhamentos.filter((s) => s.available).map((s) => (
                  <button key={s.id} onClick={() => toggleAcompanhamento(s.id)} style={choiceOption(selectedAcompanhamentos.includes(s.id))}>
                    {s.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <p style={{ color: TOKENS.inkSoft, fontSize: 13, marginBottom: 12 }}>Escolha suas saladas (opcional)</p>
          <div style={{ display: "grid", gap: 10 }}>
            {menu.saladas.filter((s) => s.available).map((s) => (
              <button key={s.id} onClick={() => toggleSalada(s.id)} style={choiceOption(selectedSaladas.includes(s.id))}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <p style={{ color: TOKENS.inkSoft, fontSize: 13, marginBottom: 12 }}>
            Escolha {principalLimit === 1 ? "1 tipo de carne" : `até ${principalLimit} tipos de carne`} ({selectedPrincipals.length}/{principalLimit})
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {menu.principals.filter((p) => p.available).map((p) => (
              <button key={p.id} onClick={() => togglePrincipal(p.id)} style={{ ...choiceOption(selectedPrincipals.includes(p.id)), display: "flex", justifyContent: "space-between" }}>
                <span>{p.name}</span>
                {p.extraPrice > 0 && size === "P" && (
                  <span style={{ fontSize: 12, fontWeight: 700 }}>+{currency(p.extraPrice)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 5 && (
        <div>
          {size && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0 14px" }}>
                <span style={{ color: TOKENS.inkSoft, fontSize: 13.5 }}>Quantas iguais a essa?</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${TOKENS.creamDeep}`, background: "#fff", color: TOKENS.red, fontSize: 16, fontWeight: 700, cursor: "pointer" }}
                  >
                    −
                  </button>
                  <span style={{ fontWeight: 700, fontSize: 15, minWidth: 18, textAlign: "center" }}>{quantity}</span>
                  <button
                    onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                    style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${TOKENS.creamDeep}`, background: "#fff", color: TOKENS.red, fontSize: 16, fontWeight: 700, cursor: "pointer" }}
                  >
                    +
                  </button>
                </div>
              </div>

              <div style={{ ...summaryBox(), marginBottom: cart.length ? 14 : 0 }}>
                <p style={{ fontSize: 11.5, letterSpacing: 1, color: TOKENS.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
                  Este item
                </p>
                <SummaryLine label="Tamanho" value={`${sizeDisplayName(size)}${quantity > 1 ? ` × ${quantity}` : ""}`} />
                {isRubacao ? (
                  <SummaryLine label="Macarrão" value={rubacaoMacarrao ? "Sim" : "Não"} />
                ) : (
                  <>
                    <SummaryLine label="Feijão" value={feijaoObj?.name} />
                    <SummaryLine label="Acompanhamentos" value={selectedAcompanhamentos.map(acompanhamentoName).join(", ")} />
                  </>
                )}
                <SummaryLine label="Saladas" value={selectedSaladas.map(saladaName).join(", ") || "Nenhuma"} />
                <SummaryLine label="Carnes" value={selectedPrincipalObjs.map((p) => p.name).join(", ")} />
                <div style={{ height: 1, background: TOKENS.creamDeep, margin: "8px 0" }} />
                <SummaryLine label="Subtotal do item" value={currency(currentItemSubtotal)} bold />
              </div>
            </>
          )}

          {!size && cart.length > 0 && (
            <p style={{ color: TOKENS.inkSoft, fontSize: 13, marginBottom: 14 }}>
              Item adicionado! Confira abaixo ou continue para finalizar o pedido.
            </p>
          )}

          {cart.length > 0 && (
            <div>
              <p style={{ fontSize: 11.5, letterSpacing: 1, color: TOKENS.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
                Já no pedido ({cart.length})
              </p>
              <div style={{ display: "grid", gap: 8 }}>
                {cart.map((it, idx) => (
                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: "#fff", border: `1px solid ${TOKENS.creamDeep}`, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 12.5, color: TOKENS.ink }}>
                      <b>{it.quantity > 1 ? `${it.quantity}× ` : ""}{sizeDisplayName(it.size)}</b> — {currency(it.subtotal)}
                      <div style={{ color: TOKENS.inkSoft, marginTop: 2 }}>{it.principal_names.join(", ")}</div>
                    </div>
                    <button onClick={() => removeCartItem(idx)} style={{ border: "none", background: "none", color: TOKENS.red, fontSize: 16, cursor: "pointer", padding: "0 0 0 10px" }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 6 && (
        <div style={{ display: "grid", gap: 10 }}>
          <button onClick={() => setDrink("none")} style={choiceOption(drink === "none")}>
            Sem bebida
          </button>
          {menu.drinks.map((d) => (
            <button key={d.id} onClick={() => setDrink(d.id)} style={{ ...choiceOption(drink === d.id), display: "flex", justifyContent: "space-between" }}>
              <span>{d.name}</span>
              <span style={{ fontWeight: 700 }}>{currency(d.price)}</span>
            </button>
          ))}
        </div>
      )}

      {step === 7 && (
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Seu nome" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Endereço de entrega" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
        </div>
      )}

      {step === 8 && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {PAYMENT_METHODS.map((p) => (
              <button key={p} onClick={() => setForm({ ...form, payment: p })} style={{ ...pill(form.payment === p), flex: 1, padding: "10px 0" }}>
                {p}
              </button>
            ))}
          </div>
          {form.payment === "Pix" ? (
            <div style={summaryBox()}>
              <p style={{ margin: "0 0 8px", fontSize: 14 }}>
                Chave Pix: <b>(83) 98842-5981</b> — Diva Refeições
              </p>
              <p style={{ margin: 0, fontSize: 13, color: TOKENS.inkSoft }}>
                Após pagar, envie o comprovante pelo WhatsApp — na próxima tela você já pode enviar direto pra nós com um toque.
              </p>
            </div>
          ) : form.payment === "Dinheiro" ? (
            <div style={summaryBox()}>
              <p style={{ margin: "0 0 12px", fontSize: 13.5, color: TOKENS.inkSoft }}>
                Pagamento em dinheiro na entrega. Total do pedido: <b style={{ color: TOKENS.ink }}>{currency(total)}</b>
              </p>
              <label style={fieldLabel()}>Vai pagar com quanto?</label>
              <input
                inputMode="decimal"
                placeholder="Ex: 50"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value.replace(/[^0-9,.]/g, ""))}
                style={{
                  width: "100%",
                  marginTop: 6,
                  padding: "11px 13px",
                  borderRadius: 10,
                  border: `1.5px solid ${TOKENS.creamDeep}`,
                  background: "#fff",
                  fontFamily: "Inter",
                  fontSize: 14.5,
                  color: TOKENS.ink,
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
              {cashAmount.trim() !== "" && (
                troco >= 0 ? (
                  <p style={{ margin: "12px 0 0", fontSize: 14, color: TOKENS.ok, fontWeight: 700 }}>
                    Troco: {currency(troco)}
                  </p>
                ) : (
                  <p style={{ margin: "12px 0 0", fontSize: 13.5, color: "#A32D2D" }}>
                    Esse valor é menor que o total do pedido ({currency(total)}).
                  </p>
                )
              )}
            </div>
          ) : (
            <div style={summaryBox()}>
              <p style={{ margin: 0, fontSize: 13.5, color: TOKENS.inkSoft }}>
                O pagamento no cartão tem acréscimo da maquineta
                {menu.cardSurcharge.value > 0
                  ? ` de ${menu.cardSurcharge.type === "percent" ? menu.cardSurcharge.value + "%" : currency(menu.cardSurcharge.value)}`
                  : " (valor a confirmar)"}
                , já somado no total. Pagamento é feito na entrega.
              </p>
            </div>
          )}
        </div>
      )}

      {step === 9 && (
        <div style={summaryBox()}>
          <p style={{ fontSize: 11.5, letterSpacing: 1, color: TOKENS.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
            Itens do pedido
          </p>
          {cart.map((it, idx) => (
            <div key={idx} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: idx < cart.length - 1 ? `1px solid ${TOKENS.creamDeep}` : "none" }}>
              <SummaryLine label={it.quantity > 1 ? `${it.quantity}× ${sizeDisplayName(it.size)}` : sizeDisplayName(it.size)} value={currency(it.subtotal)} />
              <p style={{ fontSize: 12, color: TOKENS.inkSoft, margin: "2px 0 0" }}>
                {isRubacaoSize(it.size)
                  ? `Macarrão: ${(it.side_names || []).includes("Macarrão") ? "Sim" : "Não"}`
                  : `Feijão: ${it.feijao_choice || "—"} · ${(it.side_names || []).join(", ") || "Sem acompanhamentos"}`}
                {(it.salada_names || []).length > 0 ? ` · Saladas: ${it.salada_names.join(", ")}` : ""}
                {` · Carnes: ${it.principal_names.join(", ")}`}
              </p>
            </div>
          ))}
          <div style={{ height: 1, background: TOKENS.creamDeep, margin: "10px 0" }} />
          <SummaryLine label="Bebida" value={drinkObj ? `${drinkObj.name} — ${currency(drinkObj.price)}` : "Sem bebida"} />
          <SummaryLine label="Taxa de entrega" value={currency(menu.deliveryFee)} />
          {cardExtra > 0 && <SummaryLine label="Acréscimo da maquineta" value={currency(cardExtra)} />}
          <SummaryLine label="Pagamento" value={form.payment} />
          {form.payment === "Dinheiro" && (
            <>
              <SummaryLine label="Troca com" value={currency(cashAmountNum)} />
              <SummaryLine label="Troco" value={currency(troco)} />
            </>
          )}
          <div style={{ height: 1, background: TOKENS.creamDeep, margin: "10px 0" }} />
          <SummaryLine label="Total" value={currency(total)} bold />
        </div>
      )}

      {error && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 10 }}>{error}</p>}

      {step === 5 ? (
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={() => setStep(prevStepFrom(step))} style={secondaryBtn()}>
            Voltar
          </button>
          <button onClick={() => addItemAndGoto(0)} style={{ ...secondaryBtn(), flex: 1 }}>
            + Adicionar outra quentinha
          </button>
          <button onClick={() => addItemAndGoto(6)} style={{ ...primaryBtn(), flex: 1 }}>
            Continuar
          </button>
        </div>
      ) : (
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        {step > 0 && (
          <button onClick={() => setStep(prevStepFrom(step))} style={secondaryBtn()}>
            Voltar
          </button>
        )}
        {step < steps.length - 1 ? (
          <button disabled={!canAdvance()} onClick={() => setStep(nextStepFrom(step))} style={{ ...primaryBtn(), opacity: canAdvance() ? 1 : 0.4, flex: 1 }}>
            Continuar
          </button>
        ) : (
          <button disabled={sending} onClick={confirmOrder} style={{ ...primaryBtn(), flex: 1, opacity: sending ? 0.6 : 1 }}>
            {sending ? "Enviando..." : `Confirmar pedido — ${currency(total)}`}
          </button>
        )}
      </div>
      )}
    </div>
  );
}

function SummaryLine({ label, value, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontWeight: bold ? 700 : 400, color: bold ? TOKENS.red : TOKENS.ink }}>
      <span style={{ color: bold ? TOKENS.red : TOKENS.inkSoft }}>{label}</span>
      <span style={{ textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <label style={fieldLabel()}>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          marginTop: 6,
          padding: "11px 13px",
          borderRadius: 10,
          border: `1.5px solid ${TOKENS.creamDeep}`,
          background: "#fff",
          fontFamily: "Inter",
          fontSize: 14.5,
          color: TOKENS.ink,
          boxSizing: "border-box",
          outline: "none",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ASSINATURA DO SISTEMA
// ---------------------------------------------------------------------------

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  return Math.round((due - today) / 86400000);
}

function isWithinOpeningHours(openHour, closeHour, now) {
  if (now.getDay() === 0) return false; // domingo fechado
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= openHour && h < closeHour;
}

function formatHour(h) {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min === 0 ? `${whole}h` : `${whole}h${String(min).padStart(2, "0")}`;
}

function ClosedScreen({ openHour, closeHour, now }) {
  const isSunday = now.getDay() === 0;
  return (
    <div style={{ ...card(), textAlign: "center", padding: "32px 20px" }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>🕒</div>
      <div style={{ fontFamily: "Fraunces", fontSize: 20, color: TOKENS.red, fontWeight: 700, marginBottom: 8 }}>
        Fechado no momento
      </div>
      <p style={{ fontSize: 14, color: TOKENS.inkSoft }}>
        {isSunday ? (
          <>Não abrimos aos domingos. Te esperamos de <b>segunda a sábado</b>, das <b>{formatHour(openHour)}</b> às <b>{formatHour(closeHour)}</b>!</>
        ) : (
          <>Só recebemos pedidos das <b>{formatHour(openHour)}</b> às <b>{formatHour(closeHour)}</b>, de segunda a sábado. Volta nesse horário que a gente monta sua quentinha com todo cuidado!</>
        )}
      </p>
    </div>
  );
}

function SoldOutScreen({ closeHour }) {
  return (
    <div style={{ ...card(), textAlign: "center", padding: "32px 20px" }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>🍱</div>
      <div style={{ fontFamily: "Fraunces", fontSize: 20, color: TOKENS.red, fontWeight: 700, marginBottom: 8 }}>
        Esgotado por hoje
      </div>
      <p style={{ fontSize: 14, color: TOKENS.inkSoft }}>
        As quentinhas de hoje já acabaram antes do previsto ({formatHour(closeHour)}). Volta amanhã que a gente
        já deixa tudo prontinho de novo!
      </p>
    </div>
  );
}

function RenewalScreen({ accessUntil }) {
  const dueDate = accessUntil ? new Date(accessUntil + "T00:00:00").toLocaleDateString("pt-BR") : "—";
  const waText = encodeURIComponent(
    `Olá! Minha assinatura do sistema Diva Refeições venceu em ${dueDate}. Vou fazer o pagamento de ${currency(MONTHLY_PRICE)} para renovar.`
  );
  return (
    <div style={{ ...card(), textAlign: "center", padding: "32px 20px" }}>
      <div style={{ fontFamily: "Fraunces", fontSize: 20, color: TOKENS.red, fontWeight: 700, marginBottom: 8 }}>
        Assinatura vencida
      </div>
      <p style={{ fontSize: 14, color: TOKENS.inkSoft, marginBottom: 18 }}>
        O acesso dos clientes ao cardápio está pausado desde <b>{dueDate}</b>. Renove a mensalidade de{" "}
        <b>{currency(MONTHLY_PRICE)}</b> para liberar o sistema novamente.
      </p>
      <div
        style={{
          background: "#fff",
          border: `1px solid ${TOKENS.creamDeep}`,
          borderRadius: 12,
          padding: 16,
          marginBottom: 18,
          textAlign: "left",
          fontSize: 13.5,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <b>Chave Pix:</b> {DEV_PIX_KEY}
        </div>
        <div>
          <b>Titular:</b> {DEV_NAME}
        </div>
      </div>
      <a
        href={`https://wa.me/${DEV_WHATSAPP}?text=${waText}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...primaryBtn(), display: "block", textDecoration: "none" }}
      >
        Já paguei, avisar no WhatsApp
      </a>
    </div>
  );
}

function SubscriptionPanel({ menu, refreshMenu }) {
  const [customDate, setCustomDate] = useState(menu.accessUntil || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const days = daysUntil(menu.accessUntil);

  async function extend(months) {
    setSaving(true);
    setError("");
    try {
      const base = days != null && days > 0 ? new Date(menu.accessUntil + "T00:00:00") : new Date();
      base.setMonth(base.getMonth() + months);
      const newDate = localDateStr(base);
      await sb("settings?id=eq.1", { method: "PATCH", body: JSON.stringify({ access_until: newDate }) });
      await refreshMenu();
      setCustomDate(newDate);
    } catch (e) {
      setError("Não consegui salvar. Confira se a coluna access_until existe no Supabase e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCustomDate() {
    if (!customDate) return;
    setSaving(true);
    setError("");
    try {
      await sb("settings?id=eq.1", { method: "PATCH", body: JSON.stringify({ access_until: customDate }) });
      await refreshMenu();
    } catch (e) {
      setError("Não consegui salvar. Confira se a coluna access_until existe no Supabase e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={panelCard()}>
        <h3 style={panelTitle()}>Assinatura mensal</h3>
        <p style={{ fontSize: 13.5, color: TOKENS.ink, marginBottom: 4 }}>
          Vencimento atual: <b>{menu.accessUntil ? new Date(menu.accessUntil + "T00:00:00").toLocaleDateString("pt-BR") : "não definido"}</b>
        </p>
        <p style={{ fontSize: 12.5, color: days != null && days < 0 ? "#A32D2D" : TOKENS.inkSoft, marginBottom: 16 }}>
          {days == null
            ? "Ainda sem data de validade configurada."
            : days < 0
            ? `Vencida há ${Math.abs(days)} dia${Math.abs(days) === 1 ? "" : "s"} — cliente está vendo a tela de renovação.`
            : `Faltam ${days} dia${days === 1 ? "" : "s"}.`}
        </p>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <button disabled={saving} style={{ ...primaryBtn(), flex: 1, opacity: saving ? 0.6 : 1 }} onClick={() => extend(1)}>
            {saving ? "Salvando..." : "Renovar +1 mês"}
          </button>
          <button disabled={saving} style={{ ...secondaryBtn(), flex: 1, opacity: saving ? 0.6 : 1 }} onClick={() => extend(3)}>
            +3 meses
          </button>
        </div>
        <div style={{ height: 1, background: TOKENS.creamDeep, margin: "4px 0 14px" }} />
        <label style={fieldLabel()}>Ou defina uma data exata</label>
        <div style={{ display: "flex", gap: 10 }}>
          <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} style={{ ...smallInput(), flex: 1 }} />
          <button disabled={saving} style={secondaryBtn()} onClick={saveCustomDate}>
            Salvar data
          </button>
        </div>
        {error && <p style={{ color: "#A32D2D", fontSize: 12.5, marginTop: 10 }}>{error}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PAINEL ADMIN
// ---------------------------------------------------------------------------

function AdminGate({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);

  function tryUnlock() {
    if (pin === ADMIN_PIN) onUnlock(false);
    else if (pin === DEV_PIN) onUnlock(true);
    else setErr(true);
  }

  return (
    <div style={card()}>
      <p style={{ fontSize: 13, color: TOKENS.inkSoft, marginBottom: 10 }}>
        Área restrita. Digite o PIN do painel.
      </p>
      <input
        type="password"
        value={pin}
        onChange={(e) => { setPin(e.target.value); setErr(false); }}
        style={smallInput()}
        onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
      />
      {err && <p style={{ color: "#A32D2D", fontSize: 12.5, marginTop: 6 }}>PIN incorreto.</p>}
      <button style={{ ...primaryBtn(), marginTop: 12 }} onClick={tryUnlock}>
        Entrar
      </button>
      <p style={{ fontSize: 11.5, color: TOKENS.inkSoft, marginTop: 14 }}>
        Este PIN é só um filtro simples — ainda não é login de verdade. Trocar por autenticação real é o próximo passo recomendado.
      </p>
    </div>
  );
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(d) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const formatted = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  const cap = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  if (localDateStr(d) === localDateStr(today)) return `Hoje — ${cap}`;
  if (localDateStr(d) === localDateStr(yesterday)) return `Ontem — ${cap}`;
  return cap;
}

function groupOrdersByDay(orders) {
  const map = new Map();
  for (const o of orders) {
    const key = localDateStr(o.createdAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(o);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => ({
      key,
      label: dayLabel(list[0].createdAt),
      orders: list,
      total: list.reduce((s, o) => s + o.total, 0),
    }));
}

function AdminPanel({ menu, refreshMenu, orders, refreshOrders, devMode }) {
  const [tab, setTab] = useState("cardapio");
  const [newPrincipal, setNewPrincipal] = useState("");
  const [newAcompanhamento, setNewAcompanhamento] = useState("");
  const [newSalada, setNewSalada] = useState("");
  const [newDrink, setNewDrink] = useState("");
  const [newFeijao, setNewFeijao] = useState("");
  const today = new Date();
  const [reportMode, setReportMode] = useState("dia");
  const [reportDay, setReportDay] = useState(localDateStr(today));
  const [reportMonth, setReportMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [report, setReport] = useState({ loading: true, total: 0, count: 0, countP: 0, countM: 0, countG: 0, countRP: 0, countRM: 0, countRG: 0 });
  const [expandedDays, setExpandedDays] = useState(() => new Set([localDateStr(new Date())]));

  function toggleDay(key) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function loadReport() {
      setReport((r) => ({ ...r, loading: true }));
      let start, end;
      if (reportMode === "dia") {
        start = new Date(`${reportDay}T00:00:00`);
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      } else {
        const [y, m] = reportMonth.split("-").map(Number);
        start = new Date(y, m - 1, 1);
        end = new Date(y, m, 1);
      }
      try {
        const rows = await sb(`orders?select=total,size,items&created_at=gte.${start.toISOString()}&created_at=lt.${end.toISOString()}`);
        if (cancelled) return;
        const allItems = rows.flatMap((r) => (r.items && r.items.length ? r.items : [{ size: r.size, quantity: 1 }]));
        const countBySize = (s) => allItems.filter((it) => it.size === s).reduce((sum, it) => sum + (it.quantity || 1), 0);
        setReport({
          loading: false,
          total: rows.reduce((s, r) => s + Number(r.total), 0),
          count: rows.length,
          countP: countBySize("P"),
          countM: countBySize("M"),
          countG: countBySize("G"),
          countRP: countBySize("RP"),
          countRM: countBySize("RM"),
          countRG: countBySize("RG"),
        });
      } catch (e) {
        if (!cancelled) setReport({ loading: false, total: 0, count: 0, countP: 0, countM: 0, countG: 0, countRP: 0, countRM: 0, countRG: 0, error: true });
      }
    }
    loadReport();
    return () => { cancelled = true; };
  }, [reportMode, reportDay, reportMonth]);

  async function toggleAvail(table, id, current) {
    await sb(`${table}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ available: !current }) });
    refreshMenu();
  }

  async function addItem(table, name, clear) {
    if (!name.trim()) return;
    await sb(table, { method: "POST", body: JSON.stringify({ name: name.trim(), available: true }) });
    clear("");
    refreshMenu();
  }

  async function updateSettings(patch) {
    await sb("settings?id=eq.1", { method: "PATCH", body: JSON.stringify(patch) });
    refreshMenu();
  }

  async function updateExtraPrice(id, val) {
    await sb(`principals?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ extra_price: Number(val) || 0 }) });
    refreshMenu();
  }

  async function addDrink(name, clear) {
    if (!name.trim()) return;
    await sb("drinks", { method: "POST", body: JSON.stringify({ name: name.trim(), price: 0 }) });
    clear("");
    refreshMenu();
  }

  async function updateDrinkPrice(id, val) {
    await sb(`drinks?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ price: Number(val) || 0 }) });
    refreshMenu();
  }

  async function updateStatus(dbId, status) {
    await sb(`orders?id=eq.${dbId}`, { method: "PATCH", body: JSON.stringify({ status }) });
    refreshOrders();
  }

  async function deleteOrder(dbId) {
    if (!window.confirm("Excluir este pedido? Essa ação não pode ser desfeita.")) return;
    await sb(`orders?id=eq.${dbId}`, { method: "DELETE", prefer: "return=minimal" });
    refreshOrders();
  }

  const statusFlow = ["Novo", "Em preparo", "Saiu para entrega", "Entregue"];
  const statusColor = { Novo: TOKENS.redSoft, "Em preparo": TOKENS.gold, "Saiu para entrega": "#3B6FA0", Entregue: TOKENS.ok };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <TabBtn active={tab === "cardapio"} onClick={() => setTab("cardapio")}>Cardápio do dia</TabBtn>
        <TabBtn active={tab === "pedidos"} onClick={() => setTab("pedidos")}>
          Pedidos {orders.length > 0 && <Badge>{orders.length}</Badge>}
        </TabBtn>
        {devMode && (
          <TabBtn active={tab === "assinatura"} onClick={() => setTab("assinatura")}>
            Assinatura
          </TabBtn>
        )}
      </div>

      {tab === "assinatura" && devMode && <SubscriptionPanel menu={menu} refreshMenu={refreshMenu} />}

      {tab === "cardapio" && (
        <div style={{ display: "grid", gap: 18 }}>
          <div
            style={{
              ...panelCard(),
              background: menu.soldOutDate === localDateStr(new Date()) ? "#FBE4E4" : "#fff",
              border: `1px solid ${menu.soldOutDate === localDateStr(new Date()) ? "#E3A5A5" : TOKENS.creamDeep}`,
            }}
          >
            <h3 style={panelTitle()}>Pedidos do dia</h3>
            {menu.soldOutDate === localDateStr(new Date()) ? (
              <>
                <p style={{ fontSize: 13.5, color: TOKENS.ink, marginBottom: 12 }}>
                  🍱 As quentinhas de hoje estão marcadas como <b>esgotadas</b> — o cliente está vendo o aviso de esgotado em vez do cardápio.
                </p>
                <button style={primaryBtn()} onClick={() => updateSettings({ sold_out_date: null })}>
                  Reabrir pedidos por hoje
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13.5, color: TOKENS.inkSoft, marginBottom: 12 }}>
                  Acabou a comida antes do horário de fechar? Clique abaixo pra travar novos pedidos só por hoje —
                  volta a funcionar sozinho amanhã, sem precisar lembrar de religar.
                </p>
                <button style={{ ...secondaryBtn(), borderColor: "#E3A5A5", color: "#A32D2D" }} onClick={() => updateSettings({ sold_out_date: localDateStr(new Date()) })}>
                  Esgotado por hoje — encerrar pedidos
                </button>
              </>
            )}
          </div>

          <div style={panelCard()}>
            <h3 style={panelTitle()}>Preços e taxas</h3>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              {SIZES.map((s) => (
                <div key={s} style={{ flex: 1 }}>
                  <label style={fieldLabel()}>{SIZE_LABELS[s]}</label>
                  <input type="number" defaultValue={menu.sizePrices[s]} onBlur={(e) => updateSettings({ [`size_price_${s.toLowerCase()}`]: Number(e.target.value) || 0 })} style={smallInput()} />
                </div>
              ))}
              <div style={{ flex: 1 }}>
                <label style={fieldLabel()}>Taxa de entrega</label>
                <input type="number" defaultValue={menu.deliveryFee} onBlur={(e) => updateSettings({ delivery_fee: Number(e.target.value) || 0 })} style={smallInput()} />
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${TOKENS.cream}`, paddingTop: 12, marginBottom: 12 }}>
              <label style={fieldLabel()}>Quantidade de carnes por tamanho</label>
              <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                {SIZES.map((s) => (
                  <div key={s} style={{ flex: 1 }}>
                    <span style={{ fontSize: 12, color: TOKENS.inkSoft }}>{SIZE_LABELS[s]}</span>
                    <input
                      type="number"
                      min="1"
                      defaultValue={menu.principalLimits[s]}
                      onBlur={(e) => updateSettings({ [`principal_limit_${s.toLowerCase()}`]: Number(e.target.value) || 1 })}
                      style={smallInput()}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${TOKENS.cream}`, paddingTop: 12 }}>
              <label style={fieldLabel()}>Acréscimo da maquineta (cartão)</label>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <select
                  defaultValue={menu.cardSurcharge.type}
                  onChange={(e) => updateSettings({ card_surcharge_type: e.target.value })}
                  style={{ ...smallInput(), flex: 1 }}
                >
                  <option value="percent">Percentual (%)</option>
                  <option value="fixed">Valor fixo (R$)</option>
                </select>
                <input
                  type="number"
                  defaultValue={menu.cardSurcharge.value}
                  onBlur={(e) => updateSettings({ card_surcharge_value: Number(e.target.value) || 0 })}
                  style={{ ...smallInput(), flex: 1 }}
                />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={fieldLabel()}>Horário de funcionamento (seg a sáb — domingo fica fechado automaticamente)</label>
              <p style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: -4, marginBottom: 8 }}>
                Fora desse horário, a tela do cliente mostra "Fechado no momento" em vez do cardápio.
              </p>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="23.5"
                  defaultValue={menu.openHour}
                  onBlur={(e) => updateSettings({ open_hour: Number(e.target.value) })}
                  style={{ ...smallInput(), flex: 1 }}
                />
                <span style={{ color: TOKENS.inkSoft }}>às</span>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="24"
                  defaultValue={menu.closeHour}
                  onBlur={(e) => updateSettings({ close_hour: Number(e.target.value) })}
                  style={{ ...smallInput(), flex: 1 }}
                />
              </div>
              <p style={{ fontSize: 11.5, color: TOKENS.inkSoft, marginTop: 6, marginBottom: 14 }}>
                Use números de 0 a 24 (ex: 9.5 = 9h30, 14 = 14h).
              </p>

              <label style={fieldLabel()}>Entregas e retiradas começam às</label>
              <p style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: -4, marginBottom: 8 }}>
                Isso é só um aviso mostrado pro cliente — não bloqueia o pedido, ele pode enviar normalmente antes desse horário.
              </p>
              <input
                type="number"
                step="0.5"
                min="0"
                max="24"
                defaultValue={menu.deliveryStartHour}
                onBlur={(e) => updateSettings({ delivery_start_hour: Number(e.target.value) })}
                style={{ ...smallInput(), width: 120 }}
              />
            </div>
          </div>

          <div style={panelCard()}>
            <h3 style={panelTitle()}>Rubacão</h3>
            <p style={{ fontSize: 12.5, color: TOKENS.inkSoft, marginTop: -6, marginBottom: 10 }}>
              Desligue quando não estiver vendendo Rubacão (ex: fora do sábado). A opção some da tela do cliente na hora.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: TOKENS.ink, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={menu.rubacaoEnabled}
                onChange={(e) => updateSettings({ rubacao_enabled: e.target.checked })}
              />
              Vender Rubacão hoje
            </label>
          </div>

          <div style={panelCard()}>
            <h3 style={panelTitle()}>Carnes</h3>
            <p style={{ fontSize: 12.5, color: TOKENS.inkSoft, marginTop: -6, marginBottom: 10 }}>
              O acréscimo abaixo só é cobrado na quentinha Pequena — na Média e na Grande nunca soma nada.
            </p>
            {menu.principals.map((item) => (
              <div key={item.id} style={rowLine()}>
                <span style={{ color: item.available ? TOKENS.ink : "#B5A38F", textDecoration: item.available ? "none" : "line-through" }}>
                  {item.name}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: TOKENS.inkSoft }}>+R$</span>
                  <input type="number" defaultValue={item.extraPrice} onBlur={(e) => updateExtraPrice(item.id, e.target.value)} style={{ ...smallInput(), width: 60 }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: TOKENS.inkSoft, cursor: "pointer" }}>
                    <input type="checkbox" checked={item.available} onChange={() => toggleAvail("principals", item.id, item.available)} />
                    Disponível
                  </label>
                </div>
              </div>
            ))}
            <AddRow value={newPrincipal} onChange={setNewPrincipal} onAdd={() => addItem("principals", newPrincipal, setNewPrincipal)} placeholder="Nova carne" />
          </div>

          <div style={panelCard()}>
            <h3 style={panelTitle()}>Feijão</h3>
            <div style={{ marginBottom: 10 }}>
              {menu.feijaoOpcoes.map((item) => (
                <div key={item.id} style={rowLine()}>
                  <span style={{ color: item.available ? TOKENS.ink : "#B5A38F", textDecoration: item.available ? "none" : "line-through" }}>
                    {item.name}
                  </span>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: TOKENS.inkSoft, cursor: "pointer" }}>
                    <input type="checkbox" checked={item.available} onChange={() => toggleAvail("feijao_opcoes", item.id, item.available)} />
                    Disponível hoje
                  </label>
                </div>
              ))}
            </div>
            <AddRow value={newFeijao} onChange={setNewFeijao} onAdd={() => addItem("feijao_opcoes", newFeijao, setNewFeijao)} placeholder="Nova opção de feijão" />
          </div>

          <div style={panelCard()}>
            <h3 style={panelTitle()}>Acompanhamentos</h3>
            <div style={{ marginBottom: 10 }}>
              {menu.acompanhamentos.map((item) => (
                <div key={item.id} style={rowLine()}>
                  <span style={{ color: item.available ? TOKENS.ink : "#B5A38F", textDecoration: item.available ? "none" : "line-through" }}>
                    {item.name}
                  </span>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: TOKENS.inkSoft, cursor: "pointer" }}>
                    <input type="checkbox" checked={item.available} onChange={() => toggleAvail("acompanhamentos", item.id, item.available)} />
                    Disponível hoje
                  </label>
                </div>
              ))}
            </div>
            <AddRow value={newAcompanhamento} onChange={setNewAcompanhamento} onAdd={() => addItem("acompanhamentos", newAcompanhamento, setNewAcompanhamento)} placeholder="Novo acompanhamento" />
          </div>

          <div style={panelCard()}>
            <h3 style={panelTitle()}>Saladas</h3>
            <div style={{ marginBottom: 10 }}>
              {menu.saladas.map((item) => (
                <div key={item.id} style={rowLine()}>
                  <span style={{ color: item.available ? TOKENS.ink : "#B5A38F", textDecoration: item.available ? "none" : "line-through" }}>
                    {item.name}
                  </span>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: TOKENS.inkSoft, cursor: "pointer" }}>
                    <input type="checkbox" checked={item.available} onChange={() => toggleAvail("saladas", item.id, item.available)} />
                    Disponível hoje
                  </label>
                </div>
              ))}
            </div>
            <AddRow value={newSalada} onChange={setNewSalada} onAdd={() => addItem("saladas", newSalada, setNewSalada)} placeholder="Nova salada" />
          </div>

          <div style={panelCard()}>
            <h3 style={panelTitle()}>Bebidas</h3>
            {menu.drinks.map((d) => (
              <div key={d.id} style={rowLine()}>
                <span>{d.name}</span>
                <input type="number" defaultValue={d.price} onBlur={(e) => updateDrinkPrice(d.id, e.target.value)} style={{ ...smallInput(), width: 80 }} />
              </div>
            ))}
            <AddRow value={newDrink} onChange={setNewDrink} onAdd={() => addDrink(newDrink, setNewDrink)} placeholder="Nova bebida" />
          </div>
        </div>
      )}

      {tab === "pedidos" && (
        <div>
          <div style={{ ...panelCard(), marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={() => setReportMode("dia")} style={{ ...pill(reportMode === "dia"), flex: 1, padding: "8px 0" }}>Por dia</button>
              <button onClick={() => setReportMode("mes")} style={{ ...pill(reportMode === "mes"), flex: 1, padding: "8px 0" }}>Por mês</button>
            </div>
            {reportMode === "dia" ? (
              <input type="date" value={reportDay} onChange={(e) => setReportDay(e.target.value)} style={smallInput()} />
            ) : (
              <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} style={smallInput()} />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <span style={{ color: TOKENS.inkSoft, fontSize: 14 }}>Faturamento</span>
              <span style={{ fontFamily: "Fraunces", fontSize: 26, color: TOKENS.red, fontWeight: 700 }}>
                {report.loading ? "..." : currency(report.total)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 13.5, color: TOKENS.inkSoft, flexWrap: "wrap" }}>
              <span>{report.count} pedido{report.count === 1 ? "" : "s"}</span>
              <span>{report.countP} Quentinha P</span>
              <span>{report.countM} Quentinha M</span>
              <span>{report.countG} Quentinha G</span>
              <span>{report.countRP} Rubacão P</span>
              <span>{report.countRM} Rubacão M</span>
              <span>{report.countRG} Rubacão G</span>
            </div>
            {report.error && <p style={{ color: "#A32D2D", fontSize: 12.5, marginTop: 8 }}>Não consegui carregar o relatório agora.</p>}
          </div>
          {orders.length === 0 && (
            <div style={{ ...panelCard(), textAlign: "center", color: TOKENS.inkSoft }}>
              Nenhum pedido ainda. Assim que um cliente montar a quentinha, ele aparece aqui.
            </div>
          )}
          <div style={{ display: "grid", gap: 16 }}>
            {groupOrdersByDay(orders).map((day) => (
              <div key={day.key}>
                <button
                  onClick={() => toggleDay(day.key)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    background: "none",
                    border: "none",
                    borderBottom: `2px solid ${TOKENS.creamDeep}`,
                    padding: "6px 2px 8px",
                    marginBottom: 10,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontFamily: "Fraunces", fontSize: 16, color: TOKENS.red, fontWeight: 700 }}>
                    {expandedDays.has(day.key) ? "▾" : "▸"} {day.label}
                  </span>
                  <span style={{ fontSize: 13, color: TOKENS.inkSoft }}>
                    {day.orders.length} pedido{day.orders.length === 1 ? "" : "s"} · {currency(day.total)}
                  </span>
                </button>

                {expandedDays.has(day.key) && (
                  <div style={{ display: "grid", gap: 12 }}>
                    {day.orders.map((o) => (
                      <div key={o.dbId} style={panelCard()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span style={{ fontWeight: 700 }}>{o.id}</span>
                    <span style={{ marginLeft: 8, fontSize: 12, color: TOKENS.inkSoft }}>
                      {o.createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <div style={{ fontSize: 14.5, marginTop: 2 }}>{o.customerName}{o.phone ? ` · ${o.phone}` : ""}</div>
                  </div>
                  <span style={{ fontWeight: 700, color: TOKENS.red }}>{currency(o.total)}</span>
                </div>
                <div style={{ fontSize: 13.5, color: TOKENS.inkSoft, margin: "8px 0" }}>
                  {o.items.map((it, idx) => (
                    <div key={idx} style={{ marginBottom: idx < o.items.length - 1 ? 4 : 0 }}>
                      {it.quantity > 1 ? `${it.quantity}× ` : ""}{sizeDisplayName(it.size)} ·{" "}
                      {isRubacaoSize(it.size)
                        ? `Macarrão: ${(it.side_names || []).includes("Macarrão") ? "Sim" : "Não"}`
                        : `Feijão ${it.feijao_choice || "—"} · ${(it.side_names || []).join(", ")}`}
                      {(it.salada_names || []).length > 0 && <> · {it.salada_names.join(", ")}</>}
                      {" · "}Carnes: {(it.principal_names || []).join(", ")}
                    </div>
                  ))}
                  <div style={{ marginTop: 4 }}>Bebida: {o.drink}</div>
                </div>
                <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginBottom: 10 }}>
                  Entrega: {o.address} · Pagamento: {o.payment}
                  {o.payment === "Dinheiro" && o.changeAmount != null && (
                    <> · Troca com {currency(o.cashAmount)} (troco {currency(o.changeAmount)})</>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {statusFlow.map((s) => (
                    <button
                      key={s}
                      onClick={() => updateStatus(o.dbId, s)}
                      style={{
                        ...pill(o.status === s),
                        borderColor: o.status === s ? statusColor[s] : TOKENS.creamDeep,
                        background: o.status === s ? statusColor[s] : "#fff",
                        color: o.status === s ? "#fff" : TOKENS.inkSoft,
                      }}
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    onClick={() => deleteOrder(o.dbId)}
                    style={{ ...pill(false), marginLeft: "auto", color: "#A32D2D", borderColor: "#F0C9C9" }}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AddRow({ value, onChange, onAdd, placeholder }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...smallInput(), flex: 1 }}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
      />
      <button onClick={onAdd} style={{ ...pill(false), padding: "0 16px" }}>
        + Adicionar
      </button>
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "9px 18px",
        borderRadius: 999,
        border: `1.5px solid ${active ? TOKENS.red : TOKENS.creamDeep}`,
        background: active ? TOKENS.red : "#fff",
        color: active ? "#fff" : TOKENS.inkSoft,
        fontFamily: "Inter",
        fontWeight: 600,
        fontSize: 14,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children }) {
  return (
    <span style={{ background: TOKENS.gold, color: "#fff", borderRadius: 999, fontSize: 11, padding: "1px 7px", fontWeight: 700 }}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// estilos reutilizáveis
// ---------------------------------------------------------------------------

function card() {
  return {
    background: "#fff",
    borderRadius: 20,
    padding: "26px 22px",
    boxShadow: "0 10px 30px rgba(140,18,32,0.08)",
    border: `1px solid ${TOKENS.creamDeep}`,
  };
}
function panelCard() {
  return { ...card(), padding: "18px 20px" };
}
function panelTitle() {
  return { fontFamily: "Fraunces", fontSize: 17, color: TOKENS.red, margin: "0 0 12px", fontWeight: 600 };
}
function sizeOption(active) {
  return {
    display: "flex",
    alignItems: "center",
    padding: "14px 16px",
    borderRadius: 14,
    border: `2px solid ${active ? TOKENS.gold : TOKENS.creamDeep}`,
    background: active ? "#FCF6E8" : "#fff",
    cursor: "pointer",
    fontFamily: "Inter",
    color: TOKENS.ink,
    textAlign: "left",
  };
}
function choiceOption(active) {
  return {
    width: "100%",
    padding: "13px 16px",
    borderRadius: 12,
    border: `1.5px solid ${active ? TOKENS.red : TOKENS.creamDeep}`,
    background: active ? TOKENS.red : "#fff",
    color: active ? "#fff" : TOKENS.ink,
    cursor: "pointer",
    fontFamily: "Inter",
    fontSize: 14.5,
    textAlign: "left",
    fontWeight: active ? 600 : 400,
    boxSizing: "border-box",
  };
}
function primaryBtn() {
  return {
    background: TOKENS.red,
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "14px 20px",
    fontFamily: "Inter",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
  };
}
function secondaryBtn() {
  return {
    background: "#fff",
    color: TOKENS.inkSoft,
    border: `1.5px solid ${TOKENS.creamDeep}`,
    borderRadius: 12,
    padding: "14px 18px",
    fontFamily: "Inter",
    fontWeight: 600,
    fontSize: 15,
    cursor: "pointer",
  };
}
function pill(active) {
  return {
    padding: "7px 13px",
    borderRadius: 999,
    border: `1.5px solid ${active ? TOKENS.red : TOKENS.creamDeep}`,
    background: active ? TOKENS.red : "#fff",
    color: active ? "#fff" : TOKENS.inkSoft,
    fontFamily: "Inter",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  };
}
function summaryBox() {
  return { background: TOKENS.cream, borderRadius: 12, padding: "14px 16px" };
}
function fieldLabel() {
  return { fontSize: 12, color: TOKENS.inkSoft, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 };
}
function rowLine() {
  return { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${TOKENS.cream}`, fontSize: 14.5 };
}
function smallInput() {
  return {
    width: "100%",
    padding: "9px 11px",
    borderRadius: 9,
    border: `1.5px solid ${TOKENS.creamDeep}`,
    fontFamily: "Inter",
    fontSize: 14,
    color: TOKENS.ink,
    boxSizing: "border-box",
    outline: "none",
  };
}

// ---------------------------------------------------------------------------
// APP
// ---------------------------------------------------------------------------

export default function App() {
  const [menu, setMenu] = useState(null);
  const [orders, setOrders] = useState([]);
  const [view, setView] = useState("cliente");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const [loadError, setLoadError] = useState("");
  const knownOrderIds = useRef(null); // null até o primeiro carregamento (evita som ao abrir)

  const refreshMenu = useCallback(async () => {
    try {
      setMenu(await loadMenuFromSupabase());
      setLoadError("");
    } catch (e) {
      setLoadError("Não consegui carregar o cardápio agora. Verifique a conexão e tente novamente.");
    }
  }, []);

  const refreshOrders = useCallback(async () => {
    try {
      const rows = await sb("orders?select=*&order=created_at.desc&limit=100");
      const mapped = rows.map(mapOrderFromSupabase);
      const currentIds = new Set(mapped.map((o) => o.dbId));
      if (knownOrderIds.current) {
        const hasNew = [...currentIds].some((id) => !knownOrderIds.current.has(id));
        if (hasNew) playNotificationSound();
      }
      knownOrderIds.current = currentIds;
      setOrders(mapped);
    } catch (e) {
      // silencioso: mantém a última lista carregada em caso de falha pontual
    }
  }, []);

  useEffect(() => {
    refreshMenu();
    refreshOrders();
  }, [refreshMenu, refreshOrders]);

  // atualização quase em tempo real do painel (a cada 8s enquanto o admin está aberto)
  useEffect(() => {
    if (view !== "admin" || !adminUnlocked) return;
    const id = setInterval(refreshOrders, 8000);
    return () => clearInterval(id);
  }, [view, adminUnlocked, refreshOrders]);

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${TOKENS.redDark} 0%, ${TOKENS.red} 220px, ${TOKENS.cream} 220px)`, fontFamily: "Inter" }}>
      <style>{FONTS_IMPORT}</style>
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "0 16px 60px" }}>
        <header style={{ padding: "28px 4px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <Emblem size={46} />
          <div>
            <div style={{ fontFamily: "Fraunces", fontSize: 22, color: "#fff", fontWeight: 700, letterSpacing: 0.3 }}>
              Diva Refeições
            </div>
            <div style={{ fontSize: 12, color: TOKENS.goldLight, letterSpacing: 1.2, textTransform: "uppercase" }}>
              Marmitaria
            </div>
          </div>
        </header>

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button onClick={() => setView("cliente")} style={{ ...pill(view === "cliente"), flex: 1, padding: "9px 0", fontSize: 13 }}>
            Visão do cliente
          </button>
          <button onClick={() => setView("admin")} style={{ ...pill(view === "admin"), flex: 1, padding: "9px 0", fontSize: 13 }}>
            Painel admin
          </button>
        </div>

        {loadError && (
          <div style={{ ...card(), color: "#A32D2D", marginBottom: 14 }}>{loadError}</div>
        )}

        {view === "cliente" && menu && (
          <div
            style={{
              background: "#fff",
              border: `1px solid ${TOKENS.creamDeep}`,
              borderRadius: 12,
              padding: "10px 14px",
              marginBottom: 14,
              fontSize: 12.5,
              color: TOKENS.inkSoft,
              textAlign: "center",
            }}
          >
            📍 Consulte a taxa de entrega para o seu endereço antes de fechar o pedido.
            <br />
            🕐 Entregas e retiradas começam às {formatHour(menu.deliveryStartHour)} (pedidos até {formatHour(menu.closeHour)}).
          </div>
        )}

        {view === "admin" && adminUnlocked && menu && daysUntil(menu.accessUntil) != null && daysUntil(menu.accessUntil) <= 5 && (
          <div
            style={{
              background: daysUntil(menu.accessUntil) < 0 ? "#FBE4E4" : "#FFF3D6",
              border: `1px solid ${daysUntil(menu.accessUntil) < 0 ? "#E3A5A5" : "#E9CE8F"}`,
              borderRadius: 12,
              padding: "10px 14px",
              marginBottom: 14,
              fontSize: 13,
              color: TOKENS.ink,
            }}
          >
            {daysUntil(menu.accessUntil) < 0
              ? `⚠️ Assinatura vencida — o cardápio dos clientes está pausado.`
              : `⏳ Sua assinatura vence em ${daysUntil(menu.accessUntil)} dia${daysUntil(menu.accessUntil) === 1 ? "" : "s"} (${new Date(menu.accessUntil + "T00:00:00").toLocaleDateString("pt-BR")}).`}
          </div>
        )}

        {!menu ? (
          <div style={card()}>Carregando cardápio...</div>
        ) : view === "cliente" ? (
          daysUntil(menu.accessUntil) != null && daysUntil(menu.accessUntil) < 0 ? (
            <RenewalScreen accessUntil={menu.accessUntil} />
          ) : !isWithinOpeningHours(menu.openHour, menu.closeHour, now) ? (
            <ClosedScreen openHour={menu.openHour} closeHour={menu.closeHour} now={now} />
          ) : menu.soldOutDate === localDateStr(now) ? (
            <SoldOutScreen closeHour={menu.closeHour} />
          ) : (
            <CustomerFlow menu={menu} onOrderPlaced={() => refreshOrders()} />
          )
        ) : !adminUnlocked ? (
          <AdminGate onUnlock={(isDev) => { setAdminUnlocked(true); setDevMode(isDev); }} />
        ) : (
          <AdminPanel menu={menu} refreshMenu={refreshMenu} orders={orders} refreshOrders={refreshOrders} devMode={devMode} />
        )}
      </div>
    </div>
  );
}
