/** Shows the placeholder surface for the future name generator mode. */
export const NameGeneratorStub = () => (
  <form className="panel compact" aria-labelledby="name-generator-heading">
    <h2 id="name-generator-heading">Name Generator</h2>
    <p className="muted">Name generator mode is not implemented yet.</p>
    <button type="submit" disabled title="This mode is reserved for a future name generator.">
      Generate
    </button>
  </form>
);
