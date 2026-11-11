# Mapa de Risco RJ

App web (PWA) para consultar no mapa as áreas marcadas como dominadas por facções/milícias no estado do Rio de Janeiro.

- Busca por endereço (com número), rua, CEP, comunidade ou coordenada
- Para qualquer local buscado ou tocado no mapa: diz se está dentro/perto de uma área e lista as favelas num raio de 500 m a 3 km, com distância e direção
- GPS: o mapa acompanha você, mostra a área mais próxima e a direção dela, e avisa (som/vibração) ao chegar perto
- Funciona offline depois do primeiro acesso (menos a busca de endereços e as partes do mapa base ainda não vistas)

**Acesse:** https://ricardomedeiros1.github.io/mapa-risco-rj/

## Dados

| Arquivo | Origem | Licença |
|---|---|---|
| `data/areas.json` | Mapa colaborativo “[UTILIDADE PÚBLICA] Mapa Das Facções RJ” (Google My Maps), copiado em 11/11/2026 | dados públicos de terceiros |
| `data/ruas.json` | Ruas/CEPs do [CEP Aberto](https://www.cepaberto.com/) + coordenadas do CNEFE (IBGE, Censo 2022) via [cep-geo-br](https://github.com/rudycerri-eng/cep-geo-br) | ODbL 1.0 (CEP Aberto) |

Busca de endereços: [Photon](https://photon.komoot.io) (OpenStreetMap). Mapa base: © OpenStreetMap, © CARTO. Biblioteca de mapa: Leaflet (BSD-2).

**Aviso:** o mapa de áreas é colaborativo e não oficial; as divisas são aproximadas e mudam com o tempo. Use como referência, não como garantia de segurança.
