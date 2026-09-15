import { CustomFieldFacts, OrgFacts, WorkHistoryList } from "./expanded-views";
import {
  PROFICIENCY_LABELS,
  memberLabel,
  sheetSkillLevels,
  visibleCustomFields,
  type Member,
  type WorkspaceState,
} from "./domain";

/**
 * The sections a skill sheet may print (#325). Anything else on the member
 * drawer — load, leave, assignments, monthly cost — stays off the page because
 * it is not in this list, not because a hide-rule remembers to drop it.
 */
export const SKILL_SHEET_SECTIONS = [
  "identity",
  "org",
  "skills",
  "history",
  "fields",
] as const;

export const PRINT_DOCUMENT_ATTR = "data-print-document";
export const PRINT_DOCUMENT_SKILL_SHEET = "skill-sheet";

/**
 * Mark the document as the skill sheet, then hand it to the browser. The sheet
 * lives in the DOM whenever a member drawer is open; without the mark, Ctrl+P
 * from the proposal screen (which can keep that drawer open) would print both.
 */
export function printSkillSheet() {
  const root = document.documentElement;
  root.setAttribute(PRINT_DOCUMENT_ATTR, PRINT_DOCUMENT_SKILL_SHEET);
  const clear = () => {
    if (root.getAttribute(PRINT_DOCUMENT_ATTR) === PRINT_DOCUMENT_SKILL_SHEET) {
      root.removeAttribute(PRINT_DOCUMENT_ATTR);
    }
    window.removeEventListener("afterprint", clear);
  };
  window.addEventListener("afterprint", clear);
  try {
    window.print();
  } catch (error) {
    clear();
    throw error;
  }
}

export function SkillSheet({ state, member }: { state: WorkspaceState; member: Member }) {
  const fields = visibleCustomFields(state.customFields, "member", "detail");
  const skills = sheetSkillLevels(member, state.skillCatalog);
  return (
    <article className="skill-sheet" aria-hidden="true" data-member-id={member.id}>
      <header className="skill-sheet-identity">
        <p className="skill-sheet-kicker">スキルシート</p>
        <h1 className="skill-sheet-name">{memberLabel(state, member)}</h1>
        <p className="skill-sheet-role">{member.role}</p>
        <p className="skill-sheet-department">{member.department}</p>
        <p className="skill-sheet-location">{member.location}</p>
      </header>
      <div className="skill-sheet-org">
        <OrgFacts state={state} personId={member.id} />
      </div>
      <section className="skill-sheet-skills">
        <h2>スキル</h2>
        {skills.length === 0
          ? <p>スキルはまだありません</p>
          : (
              <ul>
                {skills.map((level) => (
                  <li key={level.name}>
                    {level.name}
                    <small>{level.proficiency} {PROFICIENCY_LABELS[level.proficiency]}</small>
                  </li>
                ))}
              </ul>
            )}
      </section>
      <section className="skill-sheet-history">
        <h2>業務経歴</h2>
        <WorkHistoryList entries={member.workHistory} />
      </section>
      {fields.length > 0 && (
        <section className="skill-sheet-fields">
          <CustomFieldFacts fields={fields} values={member.customValues} />
        </section>
      )}
    </article>
  );
}
