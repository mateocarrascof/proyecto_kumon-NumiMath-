"""Listas y patrones de los filtros de seguridad (entrada y salida).

PROVISIONAL: son reglas deterministas para el MVP. Tienen falsos positivos y falsos negativos
conocidos; un modelo de moderación se añade cuando exista un proveedor real. Las listas están
aquí, separadas de la lógica, para poder revisarlas y ampliarlas sin tocar el código.

Todo se compara sobre texto NORMALIZADO (ver `normalize.py`): minúsculas, sin tildes, sin
caracteres invisibles, con sustituciones tipo "m13rd4" → "mierda".
"""

from __future__ import annotations

import re

# --- Groserías e insultos: se comparan por prefijo sobre cada palabra -----------------------
# (prefijo, no subcadena: "computadora" o "disputa" no coinciden con "puta").
PROFANITY_STEMS: tuple[str, ...] = (
    "puta", "puto", "putear", "mierd", "carajo", "conchetumare", "conchesumadre", "concha",
    "culiao", "culiad", "culia", "weon", "hueon", "huevon", "weona", "maricon", "marica",
    "pendej", "pelotud", "imbecil", "estupid", "idiota", "chucha", "chuchetumare", "verga",
    "cagad", "cagar", "caga", "hdp", "ctm", "csm", "ctmre", "culo", "poto", "jodete", "joder",
    "mamon", "zorra", "perra", "baboso",
    # jerga chilena adicional
    "wea", "weas", "weada", "weadas", "huevada", "conchatumadre", "conchetumadre", "hijueputa",
    "aweonao", "maraco", "maraca",
    # inglés
    "fuck", "shit", "bitch", "asshole", "dick", "cunt", "pussy", "whore", "slut", "bastard",
    "nigg", "fag",
)  # fmt: skip

# Fragmentos tan fuertes que no tienen uso inocente: se buscan DENTRO de la palabra
# ("aweonao", "reweon"). Solo para palabras de 5 letras o más.
PROFANITY_SUBSTRINGS: tuple[str, ...] = (
    "weon", "hueon", "culiao", "culiad", "conchetum", "conchatum", "conchesum", "hijueputa",
    "hijodeput", "mierda", "fuck", "shit",
)  # fmt: skip

# Prefijos demasiado cortos o ambiguos para coincidir por prefijo: solo palabra completa.
PROFANITY_EXACT_ONLY: frozenset[str] = frozenset(
    {
        "hdp",
        "ctm",
        "csm",
        "ctmre",
        "poto",
        "caga",
        "perra",
        "culia",
        "concha",
        "marica",
        "wea",
        "weas",
        "maraca",
        "maraco",
        "dick",
        "fag",
        "nigg",
    }
)

# --- Temas inapropiados para 6-10 años (sexual, violencia, drogas, apuestas) -----------------
UNSAFE_TOPIC_STEMS: tuple[str, ...] = (
    "sexo", "sexual", "porno", "desnud", "tetas", "pene", "penes", "vagina", "violacion", "violar",
    "matar", "asesin", "suicid", "morirse", "muerte", "sangre", "arma", "armas", "pistola",
    "cuchillo",
    "droga", "cocaina", "marihuana", "alcohol", "cerveza", "borrach", "cigarr", "fumar",
    "apuesta", "casino", "secuestr", "terroris",
    "ahorcar", "degollar", "tortur", "violador", "pedofil", "veneno", "explosiv", "balazo",
    "escopeta", "rifle", "metralleta",
    # inglés
    "porn", "sexy", "kill", "murder", "suicide", "cocaine", "nude", "naked", "drugs", "weed",
    "gun", "guns", "sex",
)  # fmt: skip

# Palabras que solo cuentan completas: su prefijo aparece en palabras inocentes
# ("armar", "penetrar").
UNSAFE_TOPIC_EXACT_ONLY: frozenset[str] = frozenset(
    {"arma", "armas", "pene", "penes", "gun", "guns", "sex", "weed", "kill", "nude", "naked"}
)

# Frases peligrosas que no se pueden detectar por palabra suelta ("bomba de agua" es inocente).
UNSAFE_TOPIC_PHRASES: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"\bbomba (atomica|nuclear|molotov|casera|de tiempo)\b",
        r"\b(hacer|armar|poner|fabricar|construir) (una )?bomba\b",
        r"\bhow to (make|build) (a )?bomb\b",
    )
)

# --- Camino de apoyo: el niño parece estar angustiado o en peligro ----------------------------
# PROVISIONAL, PENDIENTE DE VALIDACIÓN PROFESIONAL (psicología infantil / protección de la niñez):
# estas frases y el mensaje que reciben deben ser revisados antes de usar la app con niños reales.
# Se evalúan ANTES que groserías y datos personales: un niño que pide ayuda no debe recibir un
# "no puedo hablar de eso". El texto nunca llega a la IA ni se guarda.
SUPPORT_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"\b(me )?quiero (morir|morirme|matarme|desaparecer)\b",
        r"\bme voy a (matar|morir)\b",
        r"\bno quiero (vivir|seguir viviendo|estar vivo|estar viva)\b",
        r"\b(quisiera|ojala) (estar muerto|estar muerta|no existir|morir)\b",
        r"\b(hacerme dano|lastimarme|me (corto|lastimo|hago dano))\b",
        r"\bme (pegan|pega|golpean|golpea|maltratan|maltrata|castigan|castiga|encierran|"
        r"amenazan|amenaza)\b",
        r"\bme (hacen|hace|hizo|hicieron) dano\b",
        r"\bme (tocan|tocaron|toco|toca)\b.{0,25}\b(cuerpo|partes|privad|desnud)",
        r"\bme (abusan|abuso|abusaron|abusa)\b",
        r"\btengo (mucho )?miedo (de|a) (mi|mis|un|una|el|la|los|las)\b",
        r"\b(estoy|me siento) (muy |super |tan )?(triste|solo|sola|mal|asustado|asustada|"
        r"deprimido|deprimida)\b",
        r"\bnadie me (quiere|escucha|ayuda)\b",
        r"\b(me hacen bullying|me hacen burla|bullying)\b",
        r"\bi want to die\b",
        r"\bkill myself\b",
        r"\b(someone |he |she |they )?(hurts?|hits?|beats?) me\b",
    )
)

# --- Intentos de manipular al modelo -------------------------------------------------------
PROMPT_INJECTION: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"\bignora\w*\b.{0,30}\b(instruccion|regla|indicacion|prompt)",
        r"\b(olvida|olvidate)\b.{0,25}\b(todo|instruccion|regla|anterior)",
        r"\bactua\b.{0,15}\bcomo\b",
        r"\beres ahora\b",
        r"\bfinge\b.{0,20}\b(ser|que)\b",
        r"\bsystem prompt\b",
        r"\bprompt (del )?sistema\b",
        r"\b(modo|mode) (desarrollador|developer|dios)\b",
        r"\bjailbreak\b",
        r"\bsin (filtros?|restriccion\w*|limites)\b",
        r"\b(repite|muestra|dime)\b.{0,25}\b(tus|las) (instruccion|regla)",
        r"\binstrucciones (anteriores|previas)\b",
        r"\bdo anything now\b",
        # más variantes en español
        r"\b(desobedece|desobedeceme|no sigas)\b.{0,25}\b(regla|instruccion|indicacion)",
        r"\b(imagina|haz de cuenta|supon) que (eres|tu eres|no tienes)\b",
        r"\b(reglas|instrucciones) del sistema\b",
        r"\b(traduce|resume|copia|imprime)\b.{0,25}\b(tus|las) (instruccion|regla|prompt)",
        r"\bnuevas? (regla|instruccion)",
        r"\bresponde (como|sin)\b",
        # inglés
        r"\bignore\b.{0,30}\b(instruction|rule|prompt|previous|above|all)",
        r"\byou are now\b",
        r"\b(pretend|act) (to be|as|like)\b",
        r"\b(reveal|show|print|repeat|tell me)\b.{0,25}\b(your|the) "
        r"(prompt|instruction|rule|system)",
        r"\b(developer|dan|god) mode\b",
        r"\bdisregard\b.{0,25}\b(instruction|rule|prompt|previous)",
        r"\bforget (everything|all|your)\b",
    )
)

# --- Datos personales (sobre texto normalizado; los números sobre el original NFKC) ----------
PII_TEXT: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"\barroba\b",
        r"\bwww\b",
        r"https?\b",
        r"\b[a-z0-9-]+\s*punto\s*(com|cl|net|org|io|me)\b",
        r"\bme llamo\b",
        r"\bmi nombre\b",
        r"\bmis? apellidos?\b",
        r"\bmi (colegio|escuela|jardin|liceo|curso se llama)\b",
        r"\bmi (profe|profesor|profesora|tia|tio|mama|papa|abuela|abuelo|hermano|hermana|"
        r"amigo|amiga|vecino|vecina)\b.{0,20}\b(se llama|se llaman|llamado|llamada)\b",
        r"\bvivo en\b",
        r"\bmi (direccion|domicilio|casa queda|casa esta)\b",
        r"\bmi (telefono|celular|numero de telefono|whatsapp|correo|email|mail)\b",
        r"\b(whatsapp|instagram|tiktok|facebook|snapchat|discord|telegram)\b",
        r"\b(mi )?cumpleanos\b",
        r"\bnaci (en|el)\b",
        r"\bme dicen\b",
        r"\bmi apodo\b",
        r"\bmy name is\b",
        r"\bi live (in|at)\b",
        r"\bmy (phone|address|school|email)\b",
        r"\b(calle|avenida|pasaje|psje|camino|poblacion|villa|condominio|block|departamento|depto)\b"
        r".{0,40}\d",
    )
)

# Sobre el texto original (NFKC, minúsculas): formatos numéricos.
PII_NUMERIC: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"[\w.+-]+@[\w-]+\.[\w.-]+",  # correo
        r"(?<![\w@])@[a-z0-9_.]{3,}",  # usuario de red social (@usuario)
        r"\b[a-z0-9-]+\.(?:com|cl|net|org|io|me|ly|gl|tv|app|xyz)\b",  # dominio
        r"\+\s?56[\s.-]?9?[\s.-]?\d{4}[\s.-]?\d{4}",  # +56 9 1234 5678
        r"(?<!\d)9[\s.-]?\d{4}[\s.-]?\d{4}(?!\d)",  # celular chileno
        r"\(?\b\d{1,2}\)?[\s.-]\d{4}[\s.-]\d{4}\b",  # fijo con código de área
        r"(?<!\d)\d{8,}(?!\d)",  # 8 o más dígitos seguidos (ningún ejercicio de 1° a 4° los usa)
        r"\b\d{1,2}\.?\d{3}\.?\d{3}-[\dk]\b",  # RUT
        r"\b\d{7,8}-[\dk]\b",  # RUT sin puntos
    )
)

# --- Salida de la IA: pedir datos al niño ----------------------------------------------------
ASKS_PERSONAL_DATA: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"\b(dime|dinos|escribe|escribeme|cuentame|comparte|envia|enviame|manda|mandame|pasame|"
        r"dame)\b.{0,30}"
        r"\b(tu|tus)\b.{0,15}\b(nombre|apellido|direccion|telefono|celular|correo|email|colegio|"
        r"escuela|edad|cumpleanos|foto|clave|contrasena|ubicacion|casa)\b",
        r"\bcomo te llamas\b",
        r"\bcual es tu (nombre|apellido|direccion|telefono|colegio|correo)\b",
        r"\bdonde (vives|estudias|queda tu)\b",
        r"\bcuantos anos tienes\b",
        r"\bde que (colegio|ciudad|comuna)\b",
        r"\b(manda|mandame|envia|enviame|sube|toma)\b.{0,15}\b(una )?(foto|imagen|video|selfie)\b",
        r"\bquedemos\b|\bnos vemos\b|\bencontremonos\b",
        r"\b(what is|what's|tell me) your (name|address|phone|school|age)\b",
        r"\bwhere do you (live|go to school)\b",
        r"\bhow old are you\b",
        r"\b(esto|esto es) (es )?(un )?secreto\b",
        r"\bsecreto\b.{0,30}\b(entre nosotros|solo tu y yo|nadie)\b",
        r"\bno (le )?(digas|cuentes)\b.{0,25}\b(a )?(tus? |tu )?(papa|mama|padres|profe)\b",
    )
)  # fmt: skip

# --- Fuera de tema (solo cuando no hay señal matemática) -----------------------------------------
OFF_TOPIC_TERMS: tuple[str, ...] = (
    "chiste", "cuento", "cancion", "pelicula", "serie de", "dibuja", "dibujo", "juguemos",
    "jugar", "videojuego", "minecraft", "fortnite", "roblox", "youtube", "futbol", "recetas",
    "quien eres", "como te llamas", "eres un robot", "eres una ia", "tu nombre", "tu edad",
    "horoscopo", "clima", "noticias", "politica", "religion", "dios",
)  # fmt: skip

MATH_KEYWORD_STEMS: tuple[str, ...] = (
    "suma", "sumar", "sumo", "resta", "restar", "resto", "multiplic", "dividir", "divid",
    "divis", "fraccion", "numero", "cifra", "decena", "centena", "unidad", "tabla", "perimetro",
    "area", "ecuacion", "problema", "ejercicio", "cuanto", "cuantos", "cuantas", "calcul",
    "contar", "cuenta", "mayor", "menor", "igual", "patron", "secuencia", "par", "impar",
    "mas", "menos", "doble", "triple", "mitad", "cuarto", "tercio", "medio", "cero", "uno",
    "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
    "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa",
    "cien", "mil", "primero", "segundo", "tercero", "metro", "centimetro", "litro", "kilo",
    "hora", "minuto", "figura", "triangulo", "cuadrado", "rectangulo", "circulo", "lado",
    "vertice", "redondea", "aproxim", "ordena", "compara", "estimar", "ayuda", "explica",
    "ensena", "como se", "no entiendo",
)  # fmt: skip

# Sin guion ni barra sueltos: "mamá-papá" no es una señal matemática.
MATH_SYMBOLS = re.compile(r"[0-9+*=<>%^×÷]")

# --- Salida: formato que nunca debe llegar al niño (enlaces, HTML, imágenes, código) -----------
UNSAFE_OUTPUT_FORMAT: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"\]\(",  # enlace o imagen de Markdown: [texto](destino)
        r"!\[",
        r"<\s*/?\s*[a-z!][^>]*>",  # etiqueta HTML (no confundir con "3 < 5")
        r"```",
        r"\b(mailto|javascript|data|ftp|file):",
    )
)
