# claude-mods

Mods para Claude Code.

## tecleo

Cada vez que Claude escribe o edita un archivo, se abre un panel al lado del chat con la ruta del archivo. El código nuevo se va tecleando rápido, con resaltado de sintaxis y cursor parpadeante. En una edición, las líneas que se quitan salen tachadas y se apagan, y las nuevas se teclean en su sitio. Si llegan varias ediciones seguidas, se encolan y la velocidad sube. En los cambios grandes (más de 400 líneas) se teclean solo las primeras líneas añadidas y el resto se resume. El panel se cierra solo cuando ha terminado de teclear lo que había en cola y Claude lleva un rato sin escribir.

Controles del panel (también con su tecla cuando el panel tiene el foco):

- **Pausa / Seguir** (`p`), **Saltar** la entrada actual (`s`), **Velocidad** (`v`, pasa por lento, normal y rápido sin reiniciar).
- **Sonido** (`o`): enciende o apaga el tecleo sonoro. Suena en macOS y en Windows (en Windows lo reproduce PowerShell); en Linux no.
- **Abrir en editor** (`e`): abre el archivo en la línea donde terminó de teclear.
- **Historial** (`h`): las 30 últimas entradas; pulsa cualquiera para volver a verla. Debajo, «Tocados:» lista los archivos tocados, aunque sea uno solo.
- Si llegan más de 5 cambios de golpe, los antiguos se saltan y el panel avisa con «N cambios saltados» y un botón **Ver** para reproducirlos.
- Cuando se vacía la cola, un resumen: «✓ 3 archivos, +42 −7».
- Si Claude cambia archivos con Bash o PowerShell (`>`, `tee`, `sed -i`, `mv`, `Set-Content`…), aparece un aviso «archivo cambiado por terminal» con el comando y los archivos que nombra.

Comandos: `/tecleo` abre o cierra el panel, y `/tecleo demo` reproduce una edición de ejemplo. También `/tecleo pausa` (pausa o reanuda), `/tecleo seguir`, `/tecleo saltar`, `/tecleo lento`, `/tecleo normal`, `/tecleo rapido`, `/tecleo sonido`, `/tecleo historial` y `/tecleo editor`.

Por defecto teclea unas 70 letras por segundo; un cambio largo acelera para no tardar más de unos 6 segundos. En la terminal la animación va a 30 fotogramas por segundo; en la app de escritorio, VS Code y el móvil la mueve el propio mod, a unos 20.

Opciones (en `/config` o al instalar): `velocidad` (lento, normal o rapido), `abrirSolo` (abrir el panel al editar), `cerrarTras` (segundos sin escribir antes de cerrarlo; 0 lo deja abierto), `sonido` (un tecleo suave mientras escribe; apagado por defecto; suena en macOS y Windows, no en Linux), `volumen` (bajo, medio o alto; por defecto bajo) y `editor` (el comando para abrir archivos, por defecto `code -g {archivo}:{linea}`; por ejemplo `cursor -g {archivo}:{linea}` o `subl {archivo}:{linea}`).

### Actualizar

Desde una shell, y luego reinicia Claude:

```
claude plugin marketplace update claude-mods
claude plugin update tecleo@claude-mods
```

### Instalar

En la terminal, dentro de Claude Code:

```
/plugin install tecleo --marketplace HerrKlicova/claude-mods
```

Desde una shell:

```
claude plugin install tecleo --marketplace HerrKlicova/claude-mods
```

En la app de escritorio, donde `/plugin` no funciona: pulsa + junto al cuadro de texto, luego Plugins, Add marketplace con `HerrKlicova/claude-mods`, y después Add plugin.
