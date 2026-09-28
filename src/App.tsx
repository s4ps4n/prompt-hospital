function App() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: '#2b2117',
        color: '#f6edd6',
        fontFamily: 'Verdana, Tahoma, sans-serif',
        textAlign: 'center',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 28, color: '#f7d23a', letterSpacing: '.06em' }}>
        PROMPT HOSPITAL
      </h1>
      <p style={{ margin: 0, opacity: 0.7 }}>
        Каркас готов. Дальше — журнал, сцена, персонажи.
      </p>
    </main>
  )
}

export default App
