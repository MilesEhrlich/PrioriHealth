import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LogoMark, Wordmark } from "../components/Brand";
import { useAuth } from "../lib/hooks";

const STEPS = [
  ["Scan", "Point your phone's camera at the code."],
  ["Enter your code", "Type the patient code from your check-in ticket."],
  ["Stay updated", "Your place in line and estimated wait update automatically."],
];

/** Printable waiting-room sign whose QR code opens the patient status page. */
export default function QrSignPage() {
  const { user } = useAuth();
  const url = `${window.location.origin}/status`;
  const [svg, setSvg] = useState("");

  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1C2B24", light: "#FFFFFF" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [url]);

  return (
    <>
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.5in; }
          body { background: #fff !important; }
          header, footer, .no-print { display: none !important; }
          main { padding: 0 !important; }
          .sign { border: none !important; box-shadow: none !important; margin: 0 !important; }
          .min-h-screen, .pt-14 { min-height: 0 !important; padding-top: 0 !important; background: #fff !important; }
        }
      `}</style>
      <div className="no-print mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 pt-8 md:px-8">
        <div>
          <h1 className="text-[26px] leading-8 font-semibold tracking-[-0.3px] text-ink">Waiting-room QR sign</h1>
          <p className="mt-1.5 text-sm text-muted">Print this and put it where patients wait. It opens the patient status page.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/app/waiting" className="btn btn-tertiary">
            Back to waiting room
          </Link>
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print sign
          </button>
        </div>
      </div>

      <div className="px-4 py-6 md:px-8">
        <article className="sign mx-auto flex aspect-[8.5/11] w-full max-w-[640px] flex-col border border-line bg-surface px-[7%] py-[7%] text-center">
          <div className="flex items-center justify-center gap-3">
            <LogoMark size={36} />
            <Wordmark className="text-[26px]" />
          </div>
          {user && <div className="mt-2 text-sm text-muted">{user.hospital.name} · Emergency Department</div>}

          <h2 className="mt-[8%] text-[clamp(28px,5vw,40px)] leading-tight font-semibold tracking-[-0.6px] text-ink">
            Check your place in line
          </h2>
          <p className="mt-2 text-[clamp(15px,2.2vw,18px)] text-muted">See your estimated wait on your phone.</p>

          <div className="mx-auto mt-[7%] w-[52%] border-[6px] border-accent p-[3%]">
            {svg ? (
              <div className="[&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div className="aspect-square bg-field" />
            )}
          </div>

          <ol className="mx-auto mt-[7%] grid w-full max-w-[460px] gap-3 text-left">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="num grid size-7 shrink-0 place-items-center rounded-[3px] bg-accent text-sm font-semibold text-white">{i + 1}</span>
                <span className="text-[15px] leading-6 text-ink">
                  <span className="font-semibold">{title}.</span> <span className="text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-auto pt-[6%] text-sm text-muted">
            Or visit <span className="num font-medium text-ink">{url.replace(/^https?:\/\//, "")}</span>
          </div>
          <div className="mt-2 text-xs text-subtle">If you feel worse while waiting, tell a member of staff right away.</div>
        </article>
      </div>
    </>
  );
}
