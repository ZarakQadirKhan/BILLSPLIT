import React, { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Receipt,
  Users,
  Bell,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  LayoutDashboard,
  Settings,
  ScanLine,
  Upload,
  Check,
  CheckCheck,
  X,
  Search,
  ChevronRight,
  Copy,
  AlertCircle,
  Loader2,
  Wallet,
  ShieldCheck,
  Utensils,
  Car,
} from "lucide-react";
import {
  calculate,
  newBill,
  newRideBill,
  money,
  id,
} from "../shared/calculations.js";
import { request, saveSession, token } from "./api.js";
import {
  Avatar,
  Badge,
  Modal,
  Empty,
  Onboarding,
  NameModal,
  Profile,
  PaymentModal,
  statuses,
  shortDate,
} from "./ui.jsx";
import BillEditor from "./BillEditor.jsx";
import BillDetails from "./BillDetails.jsx";
import RideEditor from "./RideEditor.jsx";
import HomeOverview from "./HomeOverview.jsx";

export default function App() {
  const [state, setState] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [view, setView] = useState("overview"),
    [editor, setEditor] = useState(null),
    [detailId, setDetailId] = useState(null),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState("");
  const [inviteToken] = useState(() =>
    new URLSearchParams(location.hash.slice(1)).get("join"),
  );
  const [invite, setInvite] = useState(null),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const refresh = useCallback(async () => {
    if (!token()) {
      setLoading(false);
      return;
    }
    try {
      setState(await request("/state"));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    if (inviteToken)
      request(`/invite/${inviteToken}`)
        .then(setInvite)
        .catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, inviteToken]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const notify = (message) => setToast(message);
  const run = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      return null;
    }
  };
  const people = state?.people || [],
    user = state?.user,
    bills = state?.bills || [],
    debts = state?.debts || [];
  useEffect(() => {
    if (!user) return;
    const openLink = () => {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.get("bill")) {
        setEditor(null);
        setDetailId(params.get("bill"));
      }
      if (params.get("profile")) setModal({ type: "profile" });
      if (params.get("bill") || params.get("profile"))
        history.replaceState(null, "", location.pathname);
    };
    openLink();
    window.addEventListener("hashchange", openLink);
    return () => window.removeEventListener("hashchange", openLink);
  }, [user?.id]);
  const person = (personId) =>
    people.find((p) => p.id === personId) || { name: "Friend", id: personId };
  const outstanding = debts.filter((d) => d.status !== "confirmed");
  const owe = outstanding
    .filter((d) => d.debtor_id === user?.id)
    .reduce((sum, d) => sum + d.amount, 0);
  const owed = outstanding
    .filter((d) => d.creditor_id === user?.id)
    .reduce((sum, d) => sum + d.amount, 0);
  const unread = state?.events.filter((e) => !e.is_read).length || 0;
  const startBill = () => setModal({ type: "billType" });
  const startSelectedBill = (kind) => {
    setEditor(kind === "ride" ? newRideBill(user.id) : newBill(user.id));
    setDetailId(null);
    setModal(null);
  };
  const Editor = editor?.kind === "ride" ? RideEditor : BillEditor;
  const navigate = (target) => {
    if (
      editor &&
      !window.confirm(
        "Leave this editor? Save your draft first to keep recent changes.",
      )
    )
      return;
    setEditor(null);
    setDetailId(null);
    setView(target);
    setFilter("all");
  };
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool || !state) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: "read_my_balances",
          description:
            "Read the current user’s outstanding bill balances in integer paisa, including payments awaiting confirmation.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: (input) => {
            if (
              !input ||
              typeof input !== "object" ||
              Object.keys(input).length
            )
              throw Error("No arguments accepted.");
            return {
              currency: "PKR",
              youOwe: owe,
              owedToYou: owed,
              pendingRequests: outstanding.filter(
                (d) => d.debtor_id === user.id || d.creditor_id === user.id,
              ).length,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, [state, owe, owed]);
  const onBoard = async (name, recovery, username, email) => {
    const data = await request(recovery ? "/recover" : "/register", {
      method: "POST",
      body: recovery
        ? { code: recovery }
        : { name, username, email, inviteToken },
    });
    saveSession(data.token);
    await refresh();
    if (data.recoveryCode)
      setModal({ type: "recovery", code: data.recoveryCode });
    if (!recovery) {
      history.replaceState(null, "", location.pathname);
      setInvite(null);
    }
  };
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard");
    } catch {
      setModal({ type: "copy", text });
    }
  };
  const inviteLink = async (friend) => {
    const data = await request(`/friends/${friend.id}/invite`, {
      method: "POST",
    });
    setModal({
      type: "invite",
      name: friend.name,
      url: `${location.origin}/#join=${data.inviteToken}`,
    });
  };
  const addFriend = async (name) => {
    const data = await request("/friends", { method: "POST", body: { name } });
    await refresh();
    setModal({
      type: "invite",
      name: data.person.name,
      url: `${location.origin}/#join=${data.inviteToken}`,
    });
  };
  const action = async (debt, type, fields = {}) => {
    await request(`/debts/${debt.id}/action`, {
      method: "POST",
      body: { action: type, ...fields },
    });
    await refresh();
    setModal(null);
    notify(
      type === "confirm"
        ? "Payment confirmed. All settled."
        : "Payment request updated",
    );
  };
  const detail = bills.find((b) => b.id === detailId);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-icon">
            t<span>+</span>
          </span>
          tab together<span className="brand-dot">.</span>
        </a>
        <span className="nav-label">YOUR SPACE</span>
        <nav>
          {[
            { key: "overview", name: "Home", icon: LayoutDashboard },
            { key: "bills", name: "Your bills", icon: Receipt },
            { key: "friends", name: "Friends", icon: Users },
            { key: "activity", name: "Activity", icon: Bell },
          ].map(({ key, name, icon: Icon }) => (
            <button
              key={key}
              className={view === key && !editor ? "active" : ""}
              onClick={() => navigate(key)}
            >
              <Icon size={20} />
              {name}
              {key === "activity" && unread > 0 && (
                <span className="nav-count">{unread}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="free-note">
            <span className="status-dot" /> A little less awkward.
            <br />
            <span>A lot more settled.</span>
          </div>
          <button onClick={() => user && setModal({ type: "profile" })}>
            <Settings size={18} /> Your profile
          </button>
          {user && (
            <div className="sidebar-profile">
              <Avatar name={user.name} />
              <div>
                <strong>{user.name}</strong>
                <small>@{user.username}</small>
              </div>
            </div>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Your space <ChevronRight size={14} />{" "}
            {editor
              ? "New bill"
              : detail
                ? "Bill details"
                : {
                    overview: "Home",
                    bills: "Your bills",
                    friends: "Friends",
                    activity: "Activity",
                  }[view]}
          </span>
          <div className="top-actions">
            <span className="currency-label">
              PKR <span>Pakistani rupee</span>
            </span>
            <button
              className="icon-button notification-button"
              aria-label="Open activity"
              onClick={() => navigate("activity")}
            >
              <Bell size={20} />
              {unread > 0 && <i />}
            </button>
            <button
              className="profile-button"
              aria-label="Edit your profile"
              onClick={() => user && setModal({ type: "profile" })}
            >
              <Avatar name={user?.name || "You"} small />
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div className="notice error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {user && (!user.emailVerified || !user.emailConfigured) && (
            <div className="notice">
              <Bell size={18} />
              <span>
                {!user.emailConfigured
                  ? "Email sender setup is pending. In-app payment updates work normally."
                  : "Verify your email to receive bill shares and payment approval requests."}
              </span>
              <button
                className="text-button"
                onClick={() => setModal({ type: "profile" })}
              >
                Email settings
              </button>
            </div>
          )}
          {user && state?.emailDelivery?.failed > 0 && (
            <div className="notice">
              <AlertCircle size={18} />
              <span>
                Some notification emails could not be sent. Your payment records
                are safe.
              </span>
              <button
                className="text-button"
                onClick={() => setModal({ type: "profile" })}
              >
                Retry in profile
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <Loader2 className="spin" /> Opening your tab…
            </div>
          ) : !user ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">GOOD FOOD. FAIR SHARES.</div>
                  <h1>
                    Let’s settle up<span>.</span>
                  </h1>
                  <p>All your shared moments, without the mental math.</p>
                </div>
              </div>
              <Onboarding invite={invite} onSubmit={onBoard} />
            </>
          ) : editor ? (
            <Editor
              initial={editor}
              people={people}
              user={user}
              onAddFriend={() => setModal({ type: "addFriend" })}
              onProfile={() => setModal({ type: "profile" })}
              onClose={() => {
                setEditor(null);
                refresh();
              }}
              onSaved={async (bill) => {
                setEditor(null);
                await refresh();
                setDetailId(bill.id);
                notify(
                  bill.status === "draft"
                    ? "Draft saved"
                    : "Shares sent to everyone’s activity inbox",
                );
              }}
              notify={notify}
            />
          ) : detail ? (
            <BillDetails
              bill={detail}
              debts={debts.filter((d) => d.bill_id === detail.id)}
              person={person}
              user={user}
              onBack={() => setDetailId(null)}
              onEdit={() => {
                setEditor(detail);
                setDetailId(null);
              }}
              onAction={(debt, type) =>
                type === "accept"
                  ? run(() => action(debt, type))
                  : setModal({ type: "payment", debt, action: type })
              }
              onCopy={copy}
            />
          ) : (
            <>
              {invite && (
                <div className="notice">
                  <Users size={18} />
                  <span>
                    {invite.invitedBy} invited you as {invite.name}.
                  </span>
                  <button
                    className="text-button"
                    onClick={() =>
                      run(async () => {
                        await request(`/invite/${inviteToken}/claim`, {
                          method: "POST",
                        });
                        setInvite(null);
                        history.replaceState(null, "", location.pathname);
                        await refresh();
                        notify("Invitation accepted");
                      })
                    }
                  >
                    Join with my profile
                  </button>
                </div>
              )}
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {view === "overview"
                      ? "LESS MATH. MORE MEMORIES."
                      : "YOUR SHARED MOMENTS"}
                  </div>
                  <h1>
                    {view === "overview"
                      ? `Hey, ${user.name.split(" ")[0]}`
                      : view === "bills"
                        ? "Your bills"
                        : view === "friends"
                          ? "Better, together"
                          : "You’re in the loop"}
                    <span>.</span>
                  </h1>
                  <p>
                    {view === "overview"
                      ? "Here’s where you stand with your friends."
                      : view === "bills"
                        ? "Every meal, every share, every settlement."
                        : view === "friends"
                          ? "Your people. Invite them once, split whenever."
                          : "New shares, payment updates, and confirmations."}
                  </p>
                </div>
                {view !== 'overview' && <button
                  className="button primary"
                  onClick={
                    view === "friends"
                      ? () => setModal({ type: "addFriend" })
                      : startBill
                  }
                >
                  <Plus size={18} />
                  {view === "friends" ? "Add a friend" : "New split"}
                </button>}
              </div>
              {view === "overview" && <HomeOverview debts={debts} user={user} person={person} bills={bills} onOpen={setDetailId} onAction={(debt, action) => setModal({ type: 'payment', debt, action })} onCreate={startSelectedBill} onBills={() => navigate('bills')}>
                <BillList bills={bills.slice(0, 4)} debts={debts} person={person} onOpen={setDetailId} onCreate={startBill}/>
              </HomeOverview>}
              {view === "bills" && (
                <section className="card">
                  <div className="list-toolbar">
                    <div className="tabs">
                      {[
                        ["all", "All bills"],
                        ["draft", "Drafts"],
                        ["open", "Unsettled"],
                        ["settled", "Settled"],
                      ].map(([key, name]) => (
                        <button
                          key={key}
                          className={filter === key ? "active" : ""}
                          onClick={() => setFilter(key)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    <div className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Search bills"
                        placeholder="Find a bill…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <BillList
                    bills={bills.filter((b) => {
                      const settled =
                        b.status === "published" &&
                        debts
                          .filter((d) => d.bill_id === b.id)
                          .every((d) => d.status === "confirmed");
                      return (
                        b.title.toLowerCase().includes(search.toLowerCase()) &&
                        (filter === "all" ||
                          (filter === "draft" && b.status === "draft") ||
                          (filter === "open" &&
                            b.status !== "draft" &&
                            !settled) ||
                          (filter === "settled" && settled))
                      );
                    })}
                    debts={debts}
                    person={person}
                    onOpen={setDetailId}
                    onCreate={startBill}
                  />
                </section>
              )}
              {view === "friends" && (
                <div className="friends-grid">
                  {people
                    .filter((p) => p.id !== user.id)
                    .map((p, i) => {
                      const to = outstanding
                          .filter(
                            (d) =>
                              d.creditor_id === p.id && d.debtor_id === user.id,
                          )
                          .reduce((s, d) => s + d.amount, 0),
                        from = outstanding
                          .filter(
                            (d) =>
                              d.debtor_id === p.id && d.creditor_id === user.id,
                          )
                          .reduce((s, d) => s + d.amount, 0);
                      return (
                        <section className="card friend-card" key={p.id}>
                          <div className="friend-top">
                            <Avatar name={p.name} index={i} />
                            <span
                              className={`badge ${p.claimed ? "status-confirmed" : ""}`}
                            >
                              {p.claimed ? "Joined" : "Invite pending"}
                            </span>
                          </div>
                          <h2>{p.name}</h2>
                          {p.username && <p className="muted">@{p.username}</p>}
                          <div className="friend-balances">
                            <span>
                              You owe <b>{money(to)}</b>
                            </span>
                            <span>
                              Owes you <b>{money(from)}</b>
                            </span>
                          </div>
                          {!p.claimed ? (
                            <button
                              className="button"
                              onClick={() => run(() => inviteLink(p))}
                            >
                              <Copy size={16} /> Get invitation link
                            </button>
                          ) : (
                            <span className="friend-joined">
                              <CheckCheck size={17} /> Ready for the next shared
                              meal
                            </span>
                          )}
                        </section>
                      );
                    })}
                  <button
                    className="add-friend-card"
                    onClick={() => setModal({ type: "addFriend" })}
                  >
                    <span>
                      <Plus size={25} />
                    </span>
                    <h3>Bring a friend</h3>
                    <p>Add a name and share their invitation.</p>
                  </button>
                </div>
              )}
              {view === "activity" && (
                <section className="card">
                  <div className="section-heading">
                    <h2>Your inbox</h2>
                    <button
                      className="text-button"
                      onClick={() =>
                        run(async () => {
                          await request("/events/read", { method: "POST" });
                          await refresh();
                        })
                      }
                    >
                      <CheckCheck size={17} /> Mark all read
                    </button>
                  </div>
                  {state.events.length ? (
                    state.events.map((e) => (
                      <button
                        key={e.id}
                        className={`activity-row ${!e.is_read ? "unread" : ""}`}
                        onClick={() => e.bill_id && setDetailId(e.bill_id)}
                      >
                        <span className="activity-icon">
                          <Bell size={18} />
                        </span>
                        <span>
                          <strong>{e.message}</strong>
                          <small>
                            {new Date(e.created_at).toLocaleString("en-GB")}
                          </small>
                        </span>
                        <ChevronRight size={18} />
                      </button>
                    ))
                  ) : (
                    <Empty
                      icon={Bell}
                      title="A quiet inbox"
                      text="New bill assignments and payment updates will appear here."
                    />
                  )}
                  <p className="footnote">
                    Updates refresh while the app is open. No SMS, email, or
                    background push notifications.
                  </p>
                </section>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              tab together <span>·</span> Good friends. Clear tabs.
            </span>
            <span>
              <ShieldCheck size={13} /> No paid APIs
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal?.type === "billType" && (
        <Modal title="What are we splitting?" onClose={() => setModal(null)}>
          <div className="bill-type-options">
            <button onClick={() => startSelectedBill("food")}>
              <span className="scan-icon">
                <Utensils size={25} />
              </span>
              <span>
                <strong>Food & receipts</strong>
                <small>Scan a bill and assign who had what.</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button onClick={() => startSelectedBill("ride")}>
              <span className="scan-icon">
                <Car size={25} />
              </span>
              <span>
                <strong>inDrive ride</strong>
                <small>Choose the passengers and split the fare equally.</small>
              </span>
              <ChevronRight size={18} />
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "profile" && (
        <Profile
          user={user}
          emailDelivery={state.emailDelivery}
          onUpdated={refresh}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            await request("/profile", { method: "PATCH", body: data });
            await refresh();
            notify("Profile saved");
          }}
          onRecovery={() =>
            run(async () => {
              const data = await request("/recovery-code", { method: "POST" });
              setModal({ type: "recovery", code: data.recoveryCode });
            })
          }
        />
      )}
      {modal?.type === "addFriend" && (
        <NameModal
          title="Bring a friend"
          label="Your friend’s name"
          button="Create invitation"
          onClose={() => setModal(null)}
          onSubmit={addFriend}
        />
      )}
      {modal?.type === "invite" && (
        <Modal title={`Invite ${modal.name}`} onClose={() => setModal(null)}>
          <p className="muted">
            Share this private, single-use link with {modal.name}. They’ll
            choose their name and see their assigned bills.
          </p>
          <div className="notice">
            <AlertCircle size={18} />
            <span>
              {location.hostname === "localhost"
                ? "This localhost link only works on this computer. For a phone on your Wi-Fi, replace localhost with this computer’s network IP."
                : "Their device must be able to reach this app’s address."}
            </span>
          </div>
          <textarea
            readOnly
            rows={4}
            value={modal.url}
            aria-label="Invitation link"
          />
          <button
            className="button primary full"
            onClick={() => copy(modal.url)}
          >
            <Copy size={17} /> Copy invitation
          </button>
        </Modal>
      )}
      {modal?.type === "recovery" && (
        <Modal
          title="Keep your recovery code safe"
          onClose={() => setModal(null)}
        >
          <p className="muted">
            Your device remembers you. Save this private code to reopen your
            profile on another device. Anyone with it can access your account.
          </p>
          <textarea
            aria-label="Recovery code"
            readOnly
            rows={3}
            value={modal.code}
          />
          <button
            className="button primary full"
            onClick={() => copy(modal.code)}
          >
            <Copy size={17} /> Copy recovery code
          </button>
          <small>
            Creating a new code replaces your previous recovery code.
          </small>
        </Modal>
      )}
      {modal?.type === "copy" && (
        <Modal title="Copy this text" onClose={() => setModal(null)}>
          <textarea
            aria-label="Text to copy"
            rows={5}
            readOnly
            value={modal.text}
          />
          <p className="muted">
            Select the text and copy it using your device’s menu.
          </p>
        </Modal>
      )}
      {modal?.type === "payment" && (
        <PaymentModal
          modal={modal}
          person={person}
          onCopy={copy}
          onClose={() => setModal(null)}
          onSubmit={(fields) => action(modal.debt, modal.action, fields)}
        />
      )}
    </div>
  );
}

export { BalanceList } from './HomeOverview.jsx';
function BillList({ bills, debts, person, onOpen, onCreate }) {
  if (!bills.length)
    return (
      <Empty
        icon={Receipt}
        title="A clean slate"
        text="Add your first receipt and make splitting the bill the easy part."
      >
        <button className="text-button" onClick={onCreate}>
          Create a bill <Plus size={16} />
        </button>
      </Empty>
    );
  return (
    <div className="bill-list">
      {bills.map((b) => {
        const result = calculate(b),
          settled =
            b.status === "published" &&
            debts
              .filter((d) => d.bill_id === b.id)
              .every((d) => d.status === "confirmed");
        return (
          <button className="bill-row" key={b.id} onClick={() => onOpen(b.id)}>
            <span className="bill-icon">
              {b.kind === "ride" ? <Car size={19} /> : <Utensils size={19} />}
            </span>
            <span className="row-description">
              <strong>{b.title}</strong>
              <small>
                {shortDate(b.date)} <span>·</span> {b.participants.length}{" "}
                {b.participants.length === 1 ? "person" : "people"}{" "}
                <span>·</span> Paid by {person(b.paidBy).name}
              </small>
            </span>
            <span className="bill-row-right">
              <strong>{money(result.total)}</strong>
              <Badge status={settled ? "confirmed" : b.status} />
            </span>
            <ChevronRight size={16} />
          </button>
        );
      })}
    </div>
  );
}
