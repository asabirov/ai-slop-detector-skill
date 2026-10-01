// FIXTURE: the shape issue #40 was filed on, as it ships. A screen renders a
// table as a component and puts the basis line after it, so a rule that can only
// see a literal <table> sees nothing. Do not "clean" this file.
import { Basis, DataTable, LineChart } from '../ui';

export function Ledger({ rows, columns }: LedgerProps) {
  return (
    <section className="fin-section">
      <h2>Ledger</h2>
      <DataTable columns={columns} rows={rows} density="dense" pagerLabel="Ledger pages" />
      <Basis>
        Amounts in EUR at the bank's settled rate or the ECB reference rate on the cash
        date; internal transfers are excluded from spend and revenue
      </Basis>

      <h2>Spend per unit</h2>
      <LineChart series={rows} />
      <p className="fin-note">Figures as of the last completed month close.</p>

      <h2>Open invoices</h2>
      <DataTable columns={columns} rows={rows} />
      {/* What legitimately sits under a table: a count line and a pager. */}
      <p className="fin-rowcount">Showing 1 to 10 of 57 entries</p>

      {/* The line beside the heading instead of under the data: Company.tsx
          ships this one, and it is what #52 was filed on. */}
      <div className="fin-section__head"><h2>Revenue per unit</h2><Basis>charge month</Basis></div>
      <DataTable columns={columns} rows={rows} />
    </section>
  );
}
